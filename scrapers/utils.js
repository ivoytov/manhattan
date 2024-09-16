import { fromPath } from 'pdf2pic';
import pkg from 'tesseract.js';
const { recognize } = pkg
import { open, unlink } from 'fs/promises'


export async function extractAddress(text) {
    let courtAddresses = await readFileToArray("foreclosures/court_addresses.log")
    courtAddresses = courtAddresses.map(add => add.toLowerCase())
    const nyAddressRegex = /(?<=premises known as\s)(\d+\s+\w+(\s+\w+)*,\s+\w+(\s+\w+)*,\s+(NY|New York)\s+\d{5})/gi;

    const matches = text.match(nyAddressRegex)
    
    if(!matches) {
        return matches
    }
    console.log("Matches", matches)
    const match = matches.find(match => {
        const input = match.toLowerCase()
        return !courtAddresses.includes(input)
    })
    return match
}

export function extractBlockLot(text) {
    const blockPattern = /Block\s*[: ]\s*(\d+)/i;
    const lotPattern = /Lot\s*[: ]\s*(\d+)/i;
    const combinedPattern = /(\d{3,5})-(\d{1,4})/;

    const matchBlock = text.match(blockPattern);
    const matchLot = text.match(lotPattern);

    if (matchBlock && matchLot) return [matchBlock[1], matchLot[1]];

    const matchCombined = text.match(combinedPattern);
    if (matchCombined) return [matchCombined[1], matchCombined[2]];

    return [matchBlock, matchLot];
}

export function extractJudgement(text) {
    const regex = /^\$\d{1,3}(,\d{3})*(\.\d{2})?$/
    const match = text.match(regex);
    if (!match) return null

    // Extract the numerical amount (without the $ sign and commas)
    let numericString = match[1].replace(/,/g, ''); // Remove commas

    // Convert the numeric string to a number
    const numericAmount = parseFloat(numericString);
    return numericAmount
}

// See https://iappscontent.courts.state.ny.us/NYSCEF/live/help/IndexNumberFormats.pdf
export function extractIndexNumber(text) {
    const primaryPattern = /(\d{5,6}\/\d{4}E?)/;
    const matchPrimary = text.match(primaryPattern);
    if (matchPrimary) return matchPrimary[0];
    return null;
}



export async function extractTextFromPdf(pdfPath) {
    const options = {
        density: 100,
        saveFilename: 'temp_image',
        savePath: './',
        format: 'png',
        width: 600,
        height: 800
    };

    const convert = fromPath(pdfPath, options);

    const response = await convert(1);
    const imagePath = response.path;

    const { data: { text } } = await recognize(imagePath, 'eng');

    await unlink(imagePath);

    return text;
}
export async function readFileToArray(path) {
    const file = await open(path);
    const rows = [];
    for await (const row of file.readLines()) {
        rows.push(row);
    }
    return rows;
}

