import csv from 'csv-parser';
import { createReadStream, writeFileSync } from 'fs';
import { connect } from 'puppeteer-core';
import { stringQuoteOnlyIfNecessary as stringQuoteOnlyIfNecessaryFormatter } from '@json2csv/formatters';
import { Parser } from '@json2csv/plainjs';


const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;
const endpoint = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : SBR_WS_ENDPOINT;

console.log('Connecting to Scraping Browser...');

const boroughConfigDict = {
    "Queens": {
        courtId: "80",
        calendarId: "38968",
    },
    "Manhattan": {
        courtId: "60",
        calendarId: "38272",
    },
    "Bronx": {
        courtId: "124",
        calendarId: "38936",
    },
    "Brooklyn": {
        courtId: "46",
        calendarId: "26915",
    },
    "Staten Island": {
        courtId: "84",
        calendarId: "45221",
    },
}

let auctionLots = []
let maxDate = new Date()
maxDate.setDate(maxDate.getDate() + 14)
maxDate = maxDate.toISOString().split('T')[0]
for (const borough in boroughConfigDict) {
    const newLots = await getAuctionLots(borough, boroughConfigDict[borough], maxDate)
    console.log(`Scraped ${newLots.length} total foreclosure cases for ${borough}`)
    auctionLots = auctionLots.concat(newLots);
}


// case_number,borough,auction_date,has_nos,has_smf,has_judgement,has_nyscef
const csvFilePath = 'foreclosures/cases.csv';
const rows = [];
// Read the CSV file
createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
        rows.push(row);
    })
    .on('end', async () => {
        const newLots = auctionLots.filter(lot => !rows.some(({ borough, case_number }) => borough === lot.borough &&
            case_number === lot.case_number))
        rows.push(...newLots)
        
        console.log(`Found ${newLots.length} net new foreclosure cases before ${maxDate} across all boroughs.`)


        // Convert updated rows back to CSV
        //case_number,borough,auction_date,case_name
        const opts = {
            fields: ['case_number','borough','auction_date','case_name'],
            formatters: {
                string: stringQuoteOnlyIfNecessaryFormatter()
            }
        }
        const parser = new Parser(opts);
        const updatedCsv = parser.parse(rows) + '\n';

        // Write updated CSV to file
        writeFileSync(csvFilePath, updatedCsv, 'utf8');

        console.log('CSV file has been updated with missing block and lot values.');
    });
async function getAuctionLots(borough, { courtId, calendarId }, maxDate) {
    const browser = await connect({
        browserWSEndpoint: endpoint,
    });

    const page = await browser.newPage();

    console.log('Connected! Navigating...');
    const url = 'https://iapps.courts.state.ny.us/webcivil/FCASCalendarSearch';
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('select#cboCourt');
    await page.select('select#cboCourt', courtId); // QUEENS Superior Court
    await page.waitForSelector('select#cboCourtPart');
    await page.select('select#cboCourtPart', calendarId); // FORECLOSURE AUCTION PART

    await page.locator("input#btnFindCalendar").click();
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // check if there is an option to select on page
    if (await page.$("input#btnApply")) {
        page.locator("#showForm > tbody > tr:nth-child(6) > td > input:nth-child(1)").click()
        page.locator("input#btnApply").click()
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
    }

    // extract auction info
    const auctionLots = await page.evaluate(() => {
        const lots = Array.from(document.querySelectorAll('dt'));
        const parseDate = (dateString) => {
            // Step 1: Remove the single quotes
            dateString = dateString.replace(/'/g, "").trim();

            // Step 2: Remove the day of the week (Friday)
            let dateWithoutDay = dateString.replace(/^\w+ /, ""); // Removes the first word (the day)

            // Step 3: Create a Date object
            return new Date(dateWithoutDay);
        };
        res = lots.map(dt => {
            const onclickValue = dt.children[0].getAttribute('onclick');
            const rawDateStr = onclickValue.split(',').slice(6, 8).join(',');
            const newDate = parseDate(rawDateStr);
            const date = newDate.toISOString().split('T')[0];
            return {
                case_number: dt.childNodes[0].wholeText.split(' ')[2],
                auction_date: date,
                case_name: dt.children[0].text
            };
        });
        return res;

    });
    browser.disconnect();

    console.log(`Scraped ${auctionLots.length} total foreclosure cases.`)
    const filteredLots = auctionLots.filter(({ auction_date }) => auction_date < maxDate)
                                    .map(lot => ({ borough: borough, ...lot }))
    return filteredLots
}

