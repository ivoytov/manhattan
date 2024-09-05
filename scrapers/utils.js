import { fromPath } from 'pdf2pic';
import pkg from 'tesseract.js';
const { recognize } = pkg
import { open, unlink } from 'fs/promises'


export function extractBlockLot(text) {
    const primaryPattern = /Block\s*[: ]\s*(\d+)\s*(?:[^\d]*?)(\sand\s)Lots?\s*[: ]\s*(\d+)/i;
    const secondaryPattern = /(\d{3,4})-(\d{1,2})/;

    const matchPrimary = text.match(primaryPattern);
    if (matchPrimary) return [matchPrimary[1], matchPrimary[2]];

    const matchSecondary = text.match(secondaryPattern);
    if (matchSecondary) return [matchSecondary[1], matchSecondary[2]];

    return [null, null];
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

