import { createReadStream, writeFileSync, existsSync } from 'fs';
import csv from 'csv-parser';
import { Parser } from '@json2csv/plainjs';
import { stringQuoteOnlyIfNecessary as stringQuoteOnlyIfNecessaryFormatter } from '@json2csv/formatters'
import { extractTextFromPdf, extractBlockLot, extractJudgement } from './utils.js';
import { download_notice_of_sale } from './notice_of_sale.js'

// File paths
const csvFilePath = 'transactions/foreclosure_auctions.csv';

// Read CSV and process each row
async function processCSV() {
    const rows = [];

    // Read the CSV file
    createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
            rows.push(row);
        })
        .on('end', async () => {
            // Process rows with missing block and lot
            for (const row of rows) {
                if (!row.block || !row.lot) {
                    const indexNumber = row.case_number;
                    const pdfPath = `saledocs/${indexNumber.replace('/', '-')}.pdf`;

                    try {
                        // Check if PDF already exists
                        if (!existsSync(pdfPath)) {
                            console.log(`Couldn't find ${pdfPath}, downloading...`)
                            // Download PDF
                            const res = await download_notice_of_sale(indexNumber, row.borough);
                            if (!res) continue
                        }

                        // Extract text from PDF
                        const text = await extractTextFromPdf(pdfPath);

                        // Extract block and lot
                        const [block, lot] = extractBlockLot(text);
                        if (!block || !lot) {
                            // console.log(text)
                        }

                        // Update row with new block and lot
                        row.block = block;
                        row.lot = lot;
                        row.lien = extractJudgement(text)
                        console.log(`Updated ${indexNumber} with block: ${block} and lot: ${lot} and judgement ${row.lien}`)
                    } catch (e) {
                        console.error("Error during PDF processing:", indexNumber, e);
                    }

                }
            }

            // Configuration options for json2csv
            const opts = {
                formatters: {
                  string: stringQuoteOnlyIfNecessaryFormatter()
                }
            }

            // Convert updated rows back to CSV
            const parser = new Parser(opts);
            const updatedCsv = parser.parse(rows);
            

            // Write updated CSV to file
            writeFileSync(csvFilePath, updatedCsv, 'utf8');

            console.log('CSV file has been updated with missing block and lot values.');
        });
}

processCSV().catch(err => console.error("Error updating the CSV file", err));