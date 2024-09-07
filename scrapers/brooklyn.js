import { createWriteStream, existsSync } from 'fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { readFile, unlink, copyFile } from 'fs/promises';
import { JSDOM } from 'jsdom';
import { download_pdf } from './download_pdf.js';
import { extractTextFromPdf, extractBlockLot, extractIndexNumber, extractJudgement } from './utils.js'
import { connect } from 'puppeteer-core';
import readline from 'readline';
import { exec } from 'child_process';
import { SingleBar } from 'cli-progress'


// Check for the --interactive flag in the command-line arguments
const isInteractive = process.argv.includes('--interactive');


const rl = isInteractive ? readline.createInterface({
    input: process.stdin,
    output: process.stdout
}) : null;

async function prompt(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}


const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;
const endpoint = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : SBR_WS_ENDPOINT;


function getNextThursday(dateString) {
    // Step 1: Parse the date string into a Date object
    const date = new Date(dateString);

    // Step 2: Calculate the difference in days to the next Thursday
    // Day of the week as an integer (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const dayOfWeek = date.getUTCDay();

    // Calculate how many days until next Thursday (4)
    const daysUntilNextThursday = (4 - dayOfWeek + 7) % 7 || 7;

    // Step 3: Adjust the date
    date.setUTCDate(date.getUTCDate() + daysUntilNextThursday + 7);

    return date;
}

function convertToAddress(filename) {
    const baseName = filename.replace(/\.pdf$/i, '');
    return baseName.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

async function main() {
    const existingAuctionsFile = 'transactions/foreclosure_auctions.csv';
    let existingAuctionsData = await readFile(existingAuctionsFile, 'utf8');
    const stringifier = stringify({ header: false });
    const writeableStream = createWriteStream(existingAuctionsFile, { flags: 'a' });
    stringifier.pipe(writeableStream);

    let existingAuctions = [];
    parse(existingAuctionsData, {
        columns: true,
        skip_empty_lines: true
    }, (err, records) => {
        if (err) throw err;
        existingAuctions = records.filter(row => row.borough === 'Brooklyn').map(row => [row.date, row.case_name]);
    });

    console.log('Connecting to Scraping Browser...');

    const browser = await connect({
        browserWSEndpoint: endpoint,
    });

    const page = await browser.newPage();

    try {
        console.log('Connected! Navigating...');
        const url = 'https://www.nycourts.gov/legacyPDFs/courts/2jd/kings/civil/foreclosures/foreclosure%20scans/'
        await page.goto(url, { waitUntil: 'networkidle2' });
        console.log('Navigated! Scraping page content...');

        const html = await page.content();
        const { document } = (new JSDOM(html)).window;
        const auctionDateMatch = document.body.textContent.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);

        if (!auctionDateMatch) {
            console.log(`No auction date found.`);
            return;
        }

        const auctionDateStr = auctionDateMatch[0];
        const adjustedDate = getNextThursday(auctionDateStr)
        const auctionDate = adjustedDate.toISOString().split('T')[0];
        console.log(`Auction date found: ${auctionDate}`)

        const pdfLinks = Array.from(document.querySelectorAll('a'))
            .map(link => [link.textContent, link.href])
            .filter(([_, href]) => href && href.endsWith('.pdf'));

        const pbar = new SingleBar()
        pbar.start(pdfLinks.length, 0, { address: "n/a" })
        for (const [linkText, pdfUrl] of pdfLinks) {
            const address = convertToAddress(linkText);

            if (existingAuctions.some(([date, case_name]) => date === auctionDate && address === case_name)) {
                console.log(`Auction ${auctionDate}, ${linkText} already exists. Skipping.`);
                pbar.increment({ "address": address });
                continue;
            }

            try {
                const pdfPath = pdfUrl.split('/').pop()
                if (!existsSync(pdfPath)) {
                    await download_pdf(`https://www.nycourts.gov${pdfUrl}`);
                }
                console.log(`Extracting text from: ${pdfPath}`);

                const extractedText = await extractTextFromPdf(pdfPath);
                let indexNumber = await extractIndexNumber(extractedText)
                let [block, lot] = extractBlockLot(extractedText);

                if (isInteractive && (!block || !lot || !indexNumber)) {
                    // Open the PDF file with the default application on macOS
                    const child = exec(`open "${pdfPath}"`);

                    // Get 'block' and 'lot' from the user
                    console.log("\n\n")
                    if (!indexNumber) {
                        indexNumber = await prompt('Enter index #: ');
                    }

                    // Close the PDF
                    exec(`osascript -e 'tell application "Preview" to close (every document whose path is "${pdfPath}")'`);
                }
                const lien = extractJudgement(extractedText)

                stringifier.write(['Brooklyn', auctionDate, indexNumber, address, block, lot, lien])
                console.log(`Added new auction data for ${linkText}`);
                if (indexNumber != null) {
                    const newFileName = "saledocs/" + indexNumber.replace('/', '-') + '.pdf'
                    await copyFile(pdfPath, newFileName)
                }

                await unlink(pdfPath);

            } catch (error) {
                console.error(`Error processing ${linkText}: ${error.message}`);
                // Optionally, you can add a retry mechanism here 
            } finally {
                pbar.increment({ "address": address })
            }
        }
        pbar.stop()
    } finally {

        rl.close()
        await browser.close();
        stringifier.end(); // End the stringifier stream properly
    }
}

main().catch(err => console.error(err));