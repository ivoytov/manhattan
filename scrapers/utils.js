import { fromPath } from 'pdf2pic';
import pkg from 'tesseract.js';
const { recognize } = pkg
import { open, unlink } from 'fs/promises'


export function extractBlockLot(text) {
    const primaryPattern = /Block\s*[: ]\s*(\d+)\s*(?:[^\d]*?)\sand\sL[ao]+ts?\s*[: ]\s*(\d+)/i;
    const secondaryPattern = /(\d{3,5})-(\d{1,4})/;

    const matchPrimary = text.match(primaryPattern);
    if (matchPrimary) return [matchPrimary[1], matchPrimary[2]];

    const matchSecondary = text.match(secondaryPattern);
    if (matchSecondary) return [matchSecondary[1], matchSecondary[2]];

    return [null, null];
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

