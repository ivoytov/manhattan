import { createWriteStream } from 'fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { readFile, unlink, copyFile } from 'fs/promises';
import { JSDOM } from 'jsdom';
import { download_pdf } from './download_pdf';
import {extractTextFromPdf, extractBlockLot, extractIndexNumber, extractJudgement } from './utils'
import { connect } from 'puppeteer-core';

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

            // console.log(`Processing PDF: ${pdfUrl} (Link text: ${linkText})`);
            try {
                const downloadedFileName = await download_pdf(`https://www.nycourts.gov${pdfUrl}`);
                console.log(`Extracting text from: ${downloadedFileName}`);

                const extractedText = await extractTextFromPdf(downloadedFileName);
                const indexNumber = await extractIndexNumber(extractedText)

                const [block, lot] = extractBlockLot(extractedText);
                if (!block || !lot) {
                    console.log(`Block and lot not found in ${pdfUrl}.`);
                    console.log("-------EXTRACTED PDF --------");
                    console.log(extractedText);
                }
                const lien = extractJudgement(extractedText)
                const address = convertToAddress(linkText);

                stringifier.write(['Brooklyn', auctionDate, indexNumber, address, block, lot, lien])
                console.log(`Added new auction data for ${linkText}`);
                const newFileName = "saledocs/" + indexNumber.replace('/','-') + '.pdf'
                await copyFile(downloadedFileName, newFileName)
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