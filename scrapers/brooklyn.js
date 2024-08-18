const fs = require('fs/promises');
const fsAsync = require('fs')
const pdf2pic = require('pdf2pic');
const Tesseract = require('tesseract.js');
const { parse } = require('csv-parse');
const path = require('path'); 

const { stringify } = require('csv-stringify');
const { readFile, unlink } = require('fs/promises');
const { JSDOM } = require('jsdom');

const puppeteer = require('puppeteer-core');
const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;

async function download_pdf(url) { 
    console.log(`You passed: ${url}`); 
    const browser = await puppeteer.connect({ 
        browserWSEndpoint: SBR_WS_ENDPOINT, 
    }); 

    const originalFileName = url.split('/').pop(); 
    const fileNameWithoutExt = path.parse(originalFileName).name; 
    const fileExt = path.parse(originalFileName).ext; 
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); 
    const fileName = `${fileNameWithoutExt}_${timestamp}${fileExt}`; 
    console.log(`Saving as: ${fileName}`); 

    const file = await fs.open(fileName, 'w'); 

    try { 
        console.log('Connected! Navigating to pdf...'); 
        const page = await browser.newPage(); 
        page.setDefaultNavigationTimeout(3 * 60 * 1000); 

        const client = await page.createCDPSession(); 
        await client.send('Fetch.enable', { 
            patterns: [{ 
                requestStage: 'Response', 
                resourceType: 'Document', 
            }], 
        }); 

        const requestId = await new Promise((resolve, reject) => { 
            let resolved; 
            client.on('Fetch.requestPaused', ({ requestId }) => { 
                if (resolved) { 
                    client.send('Fetch.continueRequest', { requestId }); 
                } else { 
                    resolved = true; 
                    resolve(requestId); 
                } 
            }); 
            page.goto(url).catch(e => { 
                if (!resolved) { 
                    reject(e); 
                } 
            }); 
        }); 

        console.log('Saving pdf stream to file...'); 
        const { stream } = await client.send('Fetch.takeResponseBodyAsStream', { requestId }); 

        let totalBytes = 0; 
        while (true) { 
            const { data, base64Encoded, eof } = await client.send('IO.read', { handle: stream }); 
            const chunk = Buffer.from(data, base64Encoded ? 'base64' : 'utf8'); 
            await file.write(chunk); 
            totalBytes += chunk.length; 
            console.log(`Got chunk: ${chunk.length} bytes, Total: ${totalBytes} bytes, EOF: ${eof}`); 
            if (eof) break; 
        } 
        await client.send('IO.close', { handle: stream }); 
        await client.send('Fetch.fulfillRequest', { 
            requestId: requestId, 
            responseCode: 200, 
            body: '' 
        }); 

        if (totalBytes < 1000) { 
            throw new Error("PDF content seems too small, might be corrupted."); 
        } 

        console.log('PDF downloaded successfully'); 
        return fileName; 
    } catch (e) { 
        console.error("Error during PDF processing:", e); 
        throw e; 
    } finally { 
        await file.close(); 
        await browser.close(); 
    } 
} 


async function extractTextFromPdf(pdfPath) {
    const options = {
        density: 100, 
        saveFilename: 'temp_image', 
        savePath: './', 
        format: 'png', 
        width: 600, 
        height: 800
    };

    const convert = pdf2pic.fromPath(pdfPath, options);

    const response = await convert(1);
    const imagePath = response.path;

    const { data: { text } } = await Tesseract.recognize(imagePath, 'eng');
    console.log("-------EXTRACTED PDF --------");
    console.log(text);

    await unlink(imagePath);

    return text;
}

function extractBlockLot(text) {
    const primaryPattern = /Block\s*[: ]\s*(\d+)\s*(?:[^\d]*?)Lots?\s*[: ]\s*(\d+)/i;
    const secondaryPattern = /(\d{3,4})-(\d{1,2})/;
    
    const matchPrimary = text.match(primaryPattern);
    if (matchPrimary) return [matchPrimary[1], matchPrimary[2]];
    
    const matchSecondary = text.match(secondaryPattern);
    if (matchSecondary) return [matchSecondary[1], matchSecondary[2]];
    
    return [null, null];
}

function convertToAddress(filename) {
    const baseName = filename.replace(/\.pdf$/i, '');
    return baseName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

async function main() {
    const existingAuctionsFile = 'transactions/foreclosure_auctions.csv';
    let existingAuctionsData = await readFile(existingAuctionsFile, 'utf8');
    const stringifier = stringify({ header: false });

    let existingAuctions = [];
    parse(existingAuctionsData, {
        columns: true,
        skip_empty_lines: true
    }, (err, records) => {
        if (err) throw err;
        existingAuctions = records.filter(row => row.borough === 'Brooklyn').map(row => [row.date, row.case_number]);
    });
    console.log('Connecting to Scraping Browser...');
    
    const browser = await puppeteer.connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
    });

    const page = await browser.newPage();

    try {
        console.log('Connected! Navigating...');
        await page.goto('https://www.nycourts.gov/legacyPDFs/courts/2jd/kings/civil/foreclosures/foreclosure%20scans/', { waitUntil: 'networkidle2' });
        console.log('Navigated! Scraping page content...');

        const html = await page.content();
        const { document } = (new JSDOM(html)).window;
        const auctionDateMatch = document.body.textContent.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);

        if (!auctionDateMatch) {
            console.log(`No auction date found.`);
            return;
        }

        const auctionDateStr = auctionDateMatch[0];
        const auctionDate = new Date(auctionDateStr).toISOString().split('T')[0];

        const pdfLinks = Array.from(document.querySelectorAll('a'))
            .map(link => [link.textContent, link.href])
            .filter(([_, href]) => href && href.endsWith('.pdf'));

        for (const [linkText, pdfUrl] of pdfLinks) {
            if (existingAuctions.some(([date, caseNumber]) => date === auctionDate && caseNumber === linkText)) {
                console.log(`Auction ${auctionDate}, ${linkText} already exists. Skipping.`);
                continue;
            }

            console.log(`Processing PDF: ${pdfUrl} (Link text: ${linkText})`);
            try {
                const downloadedFileName = await download_pdf(`https://www.nycourts.gov${pdfUrl}`); 
                console.log(`Extracting text from: ${downloadedFileName}`); 
                
                const extractedText = await extractTextFromPdf(downloadedFileName);

                const [block, lot] = extractBlockLot(extractedText);
                if (!block || !lot) {
                    console.log(`Block and lot not found in ${pdfUrl}.`);
                    await unlink(downloadedFileName);
                    continue;
                }

                const address = convertToAddress(linkText);

                stringifier.write([ 'Brooklyn', auctionDate, linkText, address, block, lot ])
                console.log(`Added new auction data for ${linkText}`); 
                await unlink(downloadedFileName);


            } catch (error) { 
                console.error(`Error processing ${linkText}: ${error.message}`); 
                // Optionally, you can add a retry mechanism here 
            } 
            const writeableStream = fsAsync.createWriteStream(existingAuctionsFile, {flags: 'a'});
            stringifier.pipe(writeableStream);

        }
    } finally {
        await browser.close();
    }
}

main().catch(err => console.error(err));