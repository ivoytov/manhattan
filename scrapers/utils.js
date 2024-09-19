import { fromPath } from 'pdf2pic';
import pkg from 'tesseract.js';
const { recognize } = pkg
import { open, unlink } from 'fs/promises'


export function extractAddress(text) {
    text = text.replace(/\n/g, ' ');
    const nyAddressRegex = /(?<=premises known as\s|prem\.\s*k\/a\s|lying and being at\s)([\s\S]*?)(\s+(NY|New York)(\s+\d{5})?)/gi;

    const matches = text.match(nyAddressRegex)
    if(matches) return matches[1]
    return null
}

const combinedPattern = /\s(\d{3,5})-(\d{1,4})[\.\s]/;

export function extractBlock(text) {
    const blockPattern = /Block[:\s]+(\d+)/i;
    
    const matchBlock = text.match(blockPattern);
    if (matchBlock) return matchBlock[1]

    const matchCombined = text.match(combinedPattern);
    if (matchCombined) return matchCombined[1]
    return null
}

export function extractLot(text) {
    const blockPattern = /\sLots?[:\s]+(\d+)/i;
    

    const matchBlock = text.match(blockPattern);
    if (matchBlock) return matchBlock[1]

    const matchCombined = text.match(combinedPattern);
    if (matchCombined) return matchCombined[2]
    return null
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
        saveFilename: 'temp_image',
        savePath: './',
        format: 'png',
        width: 2550,
        height: 3300,
        density: 330,
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

