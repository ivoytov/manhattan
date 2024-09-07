import { createWriteStream, existsSync } from 'fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { readFile, unlink, copyFile } from 'fs/promises';
import { JSDOM } from 'jsdom';
import { download_pdf } from './download_pdf.js';
import {extractTextFromPdf, extractBlockLot, extractIndexNumber, extractJudgement } from './utils.js'
import { connect } from 'puppeteer-core';
import readline from 'readline';
import { exec } from 'child_process';


// Check for the --interactive flag in the command-line arguments
const isInteractive = process.argv.includes('--interactive');

const rl = isInteractive ? readline.createInterface({
    input: process.stdin,
    output: process.stdout
}) : null;

async function prompt(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(parseInt(answer));
        });
    });
}


const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;

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
        existingAuctions = records.filter(row => row.borough === 'Brooklyn').map(row => [row.date, row.case_number]);
    });

    console.log('Connecting to Scraping Browser...');

    const browser = await connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
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

        for (const [linkText, pdfUrl] of pdfLinks) {
            if (existingAuctions.some(([date, caseNumber]) => date === auctionDate && caseNumber === linkText)) {
                console.log(`Auction ${auctionDate}, ${linkText} already exists. Skipping.`);
                continue;
            }

            try {
                const downloadedFileName = `saledocs/${linkText}`
                if (!existsSync(downloadedFileName)) {
                    await download_pdf(`https://www.nycourts.gov${pdfUrl}`, downloadedFileName);
                }
                console.log(`Extracting text from: ${downloadedFileName}`);

                const extractedText = await extractTextFromPdf(downloadedFileName);
                let indexNumber = await extractIndexNumber(extractedText)
                if(isInteractive && !indexNumber) {
                    const child = exec(`open "${downloadedFileName}"`);

                    // Get 'block' and 'lot' from the user
                    console.log("\nOpening pdf file")
                    indexNumber = await prompt('Enter index #: ');

                    // Close the PDF
                    exec(`osascript -e 'tell application "Preview" to close (every document whose path is "${pdfPath}")'`);
                }

                let [block, lot] = extractBlockLot(extractedText);
                if (isInteractive && (!block || !lot)) {
                    // Open the PDF file with the default application on macOS
                    const child = exec(`open "${pdfPath}"`);

                    // Get 'block' and 'lot' from the user
                    console.log("\nOpening pdf file")
                    block = await prompt('Enter block: ');
                    lot = await prompt('Enter lot: ');

                    // Close the PDF
                    exec(`osascript -e 'tell application "Preview" to close (every document whose path is "${pdfPath}")'`);
                }
                const lien = extractJudgement(extractedText)
                const address = convertToAddress(linkText);

                stringifier.write(['Brooklyn', auctionDate, indexNumber, address, block, lot, lien])
                console.log(`Added new auction data for ${linkText}`);
                if (indexNumber) {
                    const newFileName = "saledocs/" + indexNumber.replace('/','-') + '.pdf'
                    await copyFile(downloadedFileName, newFileName)
                }
                
                await unlink(downloadedFileName);

            } catch (error) {
                console.error(`Error processing ${linkText}: ${error.message}`);
                // Optionally, you can add a retry mechanism here 
            }
        }
    } finally {
        await browser.close();
        stringifier.end(); // End the stringifier stream properly
    }
}

main().catch(err => console.error(err));