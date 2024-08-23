import { connect } from 'puppeteer-core';
import { JSDOM } from 'jsdom';


const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;

const url = 'https://iapps.courts.state.ny.us/webcivil/FCASCalendarDetail?court=dRtJN9t_PLUS_u56Av1OdoOOUYw%3D%3D&court_part=CiiBT7d4MPHCi%2FfHDnFLnA%3D%3D&hSort=time&justice=ZU3fml4akqAmcvxTYPM5qw%3D%3D&hInclude=NO&hiddenDateFrom=08/21/2024&hiddenDateTo=&search=Part&hiddenOutputFormat=HTML'

console.log('Connecting to Scraping Browser...');

const browser = await connect({
    browserWSEndpoint: SBR_WS_ENDPOINT,
});

const page = await browser.newPage();

console.log('Connected! Navigating...');
await page.goto(url, { waitUntil: 'networkidle2' });
console.log('Navigated! Scraping page content...');

const html = await page.content();
const { document } = (new JSDOM(html)).window;
console.log(document)