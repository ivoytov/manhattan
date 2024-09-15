import { writeFileSync, existsSync, createReadStream } from 'fs';
import { open, readFile, readdir } from 'fs/promises'
import neatCsv from 'neat-csv'
import { Parser } from '@json2csv/plainjs';
import { stringQuoteOnlyIfNecessary as stringQuoteOnlyIfNecessaryFormatter } from '@json2csv/formatters'
import { extractTextFromPdf, extractBlockLot, extractJudgement } from './utils.js';
import { download_filing } from './notice_of_sale.js'
import { SingleBar, Presets } from 'cli-progress'
import { exec } from 'child_process';
import readline from 'readline';
import path from 'path';

// Check for the --interactive flag in the command-line arguments
const isInteractive = process.argv.includes('--interactive');

const rl = isInteractive ? readline.createInterface({
    input: process.stdin,
    output: process.stdout
}) : null;

const browser = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : null;

const pbar = new SingleBar({
    clearOnComplete: false,
    hideCursor: true,
    format: '{case_number} {bar} {percentage}% | time: {duration_formatted} | ETA: {eta_formatted} |  {value}/{total}'
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
    pbar.start(rows.length, start)
    for (const [idx, row] of subrows.entries()) {
        pbar.update(idx + start, row)
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

async function readFileToArray(path) {
    const file = await open(path);
    const rows = [];
    for await (const row of file.readLines()) {
        rows.push(row);
    }
    return rows;
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


    // pbar.start(files.length, 0)

    for (const [idx, case_number] of files.entries()) {
        // pbar.update(idx, {case_number: case_number})

        let foreclosureCase = cases.find((cse) => cse.case_number == case_number)

        if (!foreclosureCase) {
            console.log(case_number, "not found in cases.csv")
            continue
        }
        let row = lots.find((lot) => lot.case_number == case_number)

        if (!row) {
            console.log(case_number, "not found in lots.csv")
            row = { case_number: case_number, borough: foreclosureCase.borough }
            lots.push(row)
        }

        // Extract text from PDF
        const pdfPath = dir + "/" + case_number.replace('/', '-') + ".pdf"
        const text = await extractTextFromPdf(pdfPath);

        // Extract block and lot
        let [block, lot] = extractBlockLot(text);
        let address = null

        if (isInteractive) {
            // Get 'block' and 'lot' from the user
            console.log(`\nGet BBL for ${case_number}\n\n`)
            // Open the PDF file with the default application on macOS
            exec(`open "${pdfPath}"`);
            if (!row.block) {
                const input = await prompt('Enter block: ', block ?? '')
                if (input === null) break
                row.block = parseInt(input);
            }
            if (!row.lot) {
                row.lot = parseInt(await prompt('Enter lot: ', lot ?? ''))
            }
            if (!row.address) {
                const input = await prompt('Enter address: ', address ?? '')
                if (input === null) break
                row.address = input
            }
            exec(`osascript -e 'tell application "Preview" to close (every document whose path is "${pdfPath}")'`);

        }
    }

    pbar.stop()
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
