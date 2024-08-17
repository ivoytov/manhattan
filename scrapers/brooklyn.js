const fs = require('fs/promises');
const pdf2pic = require('pdf2pic');
const Tesseract = require('tesseract.js');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const { readFile, writeFile, unlink } = require('fs/promises');
const { JSDOM } = require('jsdom');

const puppeteer = require('puppeteer-core');
const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;

async function download_pdf(url) {
    console.log(`You passed: ${url}`);
    const browser = await puppeteer.connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
    });

    // Extract the file name from the URL
    const fileName = url.split('/').pop();
    console.log(`Saving as: ${fileName}`);

    try {
        console.log('Connected! Navigating to pdf...');
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(3 * 60 * 1000); // Increase timeout

        // Intercept the PDF and save it
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            request.continue();
        });

        page.on('response', async (response) => {
            // If this is the PDF response, save the content
            if (response.url() === url && response.request().resourceType() === 'document') {
                const buffer = await response.buffer();
                await fs.writeFile(fileName, buffer);
                console.log(`PDF saved as ${fileName}`);
            }
        });

        await page.goto(url, { waitUntil: 'load' });
        console.log('Done');
    } catch (e) {
        console.error("Error during PDF processing:", e);
    } finally {
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
    const existingAuctionsData = await readFile(existingAuctionsFile, 'utf8');
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
            const pdfPath = linkText
            await download_pdf(`https://www.nycourts.gov${pdfUrl}`)
            
            console.log(`Extracting text from: ${pdfPath}`);
            const extractedText = await extractTextFromPdf(pdfPath);
            const [block, lot] = extractBlockLot(extractedText);
            if (!block || !lot) {
                console.log(`Block and lot not found in ${pdfPath}.`);
                await unlink(pdfPath);
                continue;
            }

            const address = convertToAddress(linkText);

            const newAuctionData = stringify([[ 'Brooklyn', auctionDate, linkText, address, block, lot ]], {
                header: false
            });

            await writeFile(existingAuctionsFile, existingAuctionsData + newAuctionData);
            await unlink(pdfPath);
        }
    } finally {
        await browser.close();
    }
}

main().catch(err => console.error(err));