import { writeFileSync, existsSync, createReadStream } from 'fs';
import { readFile, readdir } from 'fs/promises'
import neatCsv from 'neat-csv'
import { Parser } from '@json2csv/plainjs';
import { stringQuoteOnlyIfNecessary as stringQuoteOnlyIfNecessaryFormatter } from '@json2csv/formatters'
import { extractTextFromPdf, extractBlockLot, extractJudgement, extractAddress } from './utils.js';
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

    const pbar = new SingleBar({
        clearOnComplete: false,
        hideCursor: true,
        format: '{case_number} {bar} {percentage}% | time: {duration_formatted} | ETA: {eta_formatted} |  {value}/{total}'
    }, Presets.shades_grey)
    const start = process.argv.includes('--skip') ? parseInt(process.argv[process.argv.indexOf('--skip') + 1]) : 0;
    const subrows = rows.slice(start, rows.length)
    pbar.start(rows.length, start + 1)
    for (const [idx, row] of subrows.entries()) {
        pbar.update(idx + start + 1, row)
        if (row.case_number in notInCEF) {
            continue
        }
        try {
            await download_filing(row.case_number, row.borough, browser);
        } catch (e) {
            console.warn("\n\nError with", row.case_number, row.borough, "error:", e)
        }
    }

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
        .sort((a, b) => {
        // Check if either `block` or `lot` is null in both records
        const aHasNull = a.block === null || a.lot === null;
        const bHasNull = b.block === null || b.lot === null;

        // If both A and B have `block` or `lot` as null, they are considered equal
        if (aHasNull && bHasNull) return 0;
        // If only A has `block` or `lot` as null, it comes first
        if (aHasNull) return -1;
        // If only B has `block` or `lot` as null, it comes first
        if (bHasNull) return 1;    
            
            return b.auction_date - a.auction_date
        })

    // pbar.start(casesWithFiles.length, 1)

    for (const [idx, foreclosureCase] of casesWithFiles.entries()) {
        // pbar.update(idx, foreclosureCase)
        const case_number = foreclosureCase.case_number
        console.log(`${case_number} ${foreclosureCase.borough} ${foreclosureCase.auction_date}`)
        let row = lots.find((lot) => lot.case_number == case_number)

        if (!row) {
            console.log(case_number, "not found in lots.csv")
            row = { case_number: case_number, borough: foreclosureCase.borough }
            lots.push(row)
        }

        if (row.block && row.lot && row.address) {
            continue
        }

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
        let [block, lot] = extractBlockLot(text);
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
            if (!row.address) {
                const input = await prompt('Enter address: ', address ?? '')
                if (input === null) break
                row.address = input
            }
            while(true) {
                const more = await prompt('Is there another lot in the auction (y/n)?', 'n')
                if (more == 'n') break 
                // make another row in lots
                row = { case_number: case_number, borough: foreclosureCase.borough }
                lots.push(row)
                row.block = parseInt(await prompt('Enter block: ', ''))
                row.lot = parseInt(await prompt('Enter lot: ', ''))
                row.address = await prompt('Enter address: ', '')
            }
            

            exec(`osascript -e 'tell application "Preview" to close (every document whose name is "${filename}")'`);

        }

    }

    // pbar.stop()
    if (isInteractive) rl.close()

    // Configuration options for json2csv
    const opts = {
        formatters: {
            string: stringQuoteOnlyIfNecessaryFormatter()
        }
    }

    // Convert updated rows back to CSV
    const parser = new Parser(opts);
    const updatedCsv = parser.parse(lots) + '\n';

    // Write updated CSV to file
    writeFileSync(lotsPath, updatedCsv, 'utf8');

    console.log('CSV file has been updated with missing block and lot values.');
}

// getFilings()
getBlockAndLot()
