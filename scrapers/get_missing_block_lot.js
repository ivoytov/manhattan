import { writeFileSync, existsSync, createReadStream } from 'fs';
import { readFile, readdir } from 'fs/promises'
import neatCsv from 'neat-csv'
import { Parser } from '@json2csv/plainjs';
import { stringQuoteOnlyIfNecessary as stringQuoteOnlyIfNecessaryFormatter } from '@json2csv/formatters'
import { extractTextFromPdf, extractBlock, extractLot, extractJudgement, extractAddress } from './utils.js';
import { download_filing } from './notice_of_sale.js'
import { SingleBar, Presets } from 'cli-progress'
import { exec } from 'child_process';
import readline from 'readline';
import path from 'path';
import { readFileToArray } from './utils.js';

// Check for the --interactive flag in the command-line arguments
const isInteractive = process.argv.includes('--interactive');

const rl = isInteractive ? readline.createInterface({
    input: process.stdin,
    output: process.stdout
}) : null;

const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;
const browser = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : SBR_WS_ENDPOINT;

const pbar = new SingleBar({
    clearOnComplete: false,
    hideCursor: false,
    format: '{case_number} {bar} {percentage}% | time: {duration_formatted} | ETA: {eta_formatted} |  {value}/{total} | {auction_date}'
}, Presets.shades_grey)

// Configuration options for json2csv
const opts = {
    formatters: {
        string: stringQuoteOnlyIfNecessaryFormatter()
    }
}
const parser = new Parser(opts);


// must parseInt() on the response if you want it to be a number
// Function to prompt with a default answer
async function prompt(question, defaultAnswer = '') {
    return new Promise((resolve) => {
        const formattedQuestion = defaultAnswer ? `${question} [${defaultAnswer}]: ` : `${question}: `;

        rl.question(formattedQuestion, (answer) => {
            if (answer.trim() === 'q') resolve(null)
            resolve(answer.trim() === '' ? defaultAnswer : answer);
        });
    });
}

async function getFilings() {
    // Read LOG file
    const logPath = 'foreclosures/cases.log'
    let notInCEF = await readFileToArray(logPath);
    notInCEF = notInCEF.filter(line => line.endsWith("Not in CEF")).map(line => line.split(' ')[0])
    console.log("Not in CEF", notInCEF)


    // Read the CSV file
    const casesPath = 'foreclosures/cases.csv'
    const rows = await neatCsv(await readFile(casesPath))
    const sortedRows = rows.sort((a, b) => new Date(b.auction_date) - new Date(a.auction_date))

    const start = process.argv.includes('--skip') ? parseInt(process.argv[process.argv.indexOf('--skip') + 1]) : 0;
    const subrows = sortedRows.slice(start, sortedRows.length)
    pbar.start(rows.length, start + 1)
    for (const [idx, row] of subrows.entries()) {
        pbar.update(idx + start + 1, row)
        if (row.case_number in notInCEF) {
            continue
        }
        try {
            // if auction date in the future, only get the notice of sale, otherwise get the surplus money form too
            const today = new Date()
            const filings = (new Date(row.auction_date) < today) ? null : [FilingType.NOTICE_OF_SALE]
            await download_filing(row.case_number, row.borough, browser, filings);
        } catch (e) {
            console.warn("\n\nError with", row.case_number, row.borough, "error:", e)
        }
    }

}

async function getAuctionResults() {
    // read in the cases file
    const cases = await neatCsv(await readFile("foreclosures/cases.csv"))
    const bidsPath = "foreclosures/bids.csv"
    const bids = await neatCsv(await readFile(bidsPath))

    // read in which files exist
    const dir = 'saledocs/surplusmoney'
    const items = await readdir(dir, { withFileTypes: true });

    const files = items
        .filter(item => item.isFile())
        .map(item => item.name.slice(0, item.name.length - 4).replace('-', '/'));

    const casesWithFiles = cases.filter(cse => files.some(file => file === cse.case_number))
        .sort((a, b) => new Date(b.auction_date) - new Date(a.auction_date))

    for (const foreclosureCase of casesWithFiles) {
        const case_number = foreclosureCase.case_number
        let row = bids.find((bid) => bid.case_number == case_number)

        if (!row) {
            console.log(case_number, "not found in bids.csv")
            row = { case_number: case_number, borough: foreclosureCase.borough }
            bids.push(row)
        }

        if (row.judgement && row.upset_price && row.winning_bid) { 
            continue
        }
        console.log(`${case_number} ${foreclosureCase.borough} ${foreclosureCase.auction_date}`)


        // Extract text from PDF
        const filename = case_number.replace('/', '-') + ".pdf"
        const pdfPath = dir + "/" + filename

        // Extract block and lot
        let text = null
        try {
            text = await extractTextFromPdf(pdfPath);
        } catch (e) {
            console.error(case_number, "Error extracting text from ", pdfPath, e)
            continue
        }
        

        if (isInteractive) {
            // Get 'block' and 'lot' from the user
            // Open the PDF file with the default application on macOS
            exec(`open "${pdfPath}"`);
            if (!row.judgement) {
                const input = await prompt('Enter judgement:')
                if (input == '') break
                row.judgement = parseFloat(input);
            } else {
                console.log("Judgement", row.judgement)
            }
            if (!row.upset_price) {
                const input = await prompt('Enter upset_price:')
                if (input == '') break
                row.upset_price = parseFloat(input);
            } else {
                console.log("upset_price", row.upset_price)
            }
            if (!row.winning_bid) {
                const input = await prompt('Enter winning_bid:')
                if (input == '') break
                row.winning_bid = parseFloat(input);
            } else {
                console.log("winning_bid", row.winning_bid)
            }

            exec(`osascript -e 'tell application "Preview" to close (every document whose name is "${filename}")'`);
        }

    }
    if (isInteractive) rl.close()


    // Convert updated rows back to CSV
    const updatedCsv = parser.parse(bids) + '\n';

    // Write updated CSV to file
    writeFileSync(bidsPath, updatedCsv, 'utf8');

    console.log('CSV file bids.csv has been updated with missing bid results values.');
}

// fill in lots info
async function getBlockAndLot() {
    // read in the cases file
    const cases = await neatCsv(await readFile("foreclosures/cases.csv"))
    const lotsPath = "foreclosures/lots.csv"
    const lots = await neatCsv(await readFile(lotsPath))

    // read in which files exist
    const dir = 'saledocs/noticeofsale'
    const items = await readdir(dir, { withFileTypes: true });

    const files = items
        .filter(item => item.isFile())
        .map(item => item.name.slice(0, item.name.length - 4).replace('-', '/'));

    const casesWithFiles = cases.filter(cse => files.some(file => file === cse.case_number))
        .sort((a, b) => new Date(b.auction_date) - new Date(a.auction_date))


    for (const foreclosureCase of casesWithFiles) {
        const case_number = foreclosureCase.case_number
        let row = lots.find((lot) => lot.case_number == case_number)

        if (!row) {
            console.log(case_number, "not found in lots.csv")
            row = { case_number: case_number, borough: foreclosureCase.borough }
            lots.push(row)
        }

        if (row.block && row.lot) { // && row.address) {
            continue
        }
        console.log(`${case_number} ${foreclosureCase.borough} ${foreclosureCase.auction_date}`)


        // Extract text from PDF
        const filename = case_number.replace('/', '-') + ".pdf"
        const pdfPath = dir + "/" + filename

        // Extract block and lot
        let text = null
        try {
            text = await extractTextFromPdf(pdfPath);
        } catch (e) {
            console.error(case_number, "Error extracting text from ", pdfPath, e)
            continue
        }
        let block = extractBlock(text);
        let lot = extractLot(text);
        let address = await extractAddress(text);

        if (isInteractive) {
            // Get 'block' and 'lot' from the user
            // Open the PDF file with the default application on macOS
            exec(`open "${pdfPath}"`);
            if (!row.block) {
                const input = await prompt('Enter block: ', block ?? '')
                if (input === null) break
                row.block = parseInt(input);
            } else {
                console.log("Block", row.block)
            }
            if (!row.lot) {
                row.lot = parseInt(await prompt('Enter lot: ', lot ?? ''))
            } else {
                console.log("Lot", row.lot)
            }
            // if (!row.address) {
            //     const input = await prompt('Enter address: ', address ?? '')
            //     if (input === null) break
            //     row.address = input
            // }
            while (true) {
                const more = await prompt('Is there another lot in the auction (y/n)?', 'n')
                if (more == 'n') break
                // make another row in lots
                row = { case_number: case_number, borough: foreclosureCase.borough }
                lots.push(row)
                row.block = parseInt(await prompt('Enter block: ', ''))
                row.lot = parseInt(await prompt('Enter lot: ', ''))
                // row.address = await prompt('Enter address: ', '')
            }


            exec(`osascript -e 'tell application "Preview" to close (every document whose name is "${filename}")'`);
        }
    }

    if (isInteractive) rl.close()

    // Convert updated rows back to CSV
    const updatedCsv = parser.parse(lots) + '\n';

    // Write updated CSV to file
    writeFileSync(lotsPath, updatedCsv, 'utf8');

    console.log('CSV file has been updated with missing block and lot values.');
}

// await getFilings()
// await getBlockAndLot()
await getAuctionResults()
pbar.stop()