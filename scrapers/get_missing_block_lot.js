import { createReadStream, writeFileSync, existsSync } from 'fs';
import csv from 'csv-parser';
import { parse } from 'json2csv';
import { extractTextFromPdf, extractBlockLot } from './utils.js';
import { download_notice_of_sale} from './notice_of_sale.js'

// File paths
const csvFilePath = 'transactions/foreclosure_auctions.csv';
const outputCsvPath =  'transactions/foreclosure_auctions_updated.csv';

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
            let i = 100
            // Process rows with missing block and lot
            for (const row of rows) {
                if (!row.block || !row.lot) {
                    i = i - 1;
                    if (i == 0) break
                    const indexNumber = row.case_number;
                    const pdfPath = `saledocs/${indexNumber.replace('/', '-')}.pdf`;
                    
                    try {
                        // Check if PDF already exists
                        if (!existsSync(pdfPath)) {
                            console.log(`Couldn't find ${pdfPath}, downloading...`)
                            // Download PDF
                            const res = await download_notice_of_sale(indexNumber);
                            if (!res) continue
                        }
                    
                        // Extract text from PDF
                        const text = await extractTextFromPdf(pdfPath);
                    
                        // Extract block and lot
                        const [block, lot] = extractBlockLot(text);
                    
                        // Update row with new block and lot
                        row.block = block;
                        row.lot = lot;
                        console.log(`Updated ${indexNumber} with block: ${block} and lot: ${lot}`)
                    } catch (e) {  
                        console.error("Error during PDF processing:", indexNumber, e); 
                    } 
                    
                }
            }
            
            // Convert updated rows back to CSV
            const updatedCsv = parse(rows, { fields: Object.keys(rows[0]) });

            // Write updated CSV to file
            writeFileSync(outputCsvPath, updatedCsv, 'utf8');
            
            console.log('CSV file has been updated with missing block and lot values.');
        });
}

processCSV().catch(err => console.error("Error updating the CSV file", err));