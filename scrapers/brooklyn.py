import os
import re
import tempfile
import pytesseract
import subprocess
from pathlib import Path
import csv
from selenium.webdriver import Remote, ChromeOptions
from selenium.webdriver.chromium.remote_connection import ChromiumRemoteConnection
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from pdf2image import convert_from_path
import requests
from datetime import datetime

# Get the AUTH variable from the environment variable BRIGHTDATA_AUTH
AUTH = os.getenv('BRIGHTDATA_AUTH')
PROXY = os.getenv('BRIGHTDATA_PROXY')
if not AUTH:
    raise ValueError("BRIGHTDATA_AUTH environment variable is not set.")
if not PROXY:
    raise ValueError("BRIGHTDATA_PROXY environment variable is not set.")

proxies = {
    'http': PROXY,
    'https': PROXY
}
SBR_WEBDRIVER = f'https://{AUTH}@brd.superproxy.io:9515'

def extract_text_from_pdf(pdf_path):
    # Convert the PDF to a PNG image using pdf2image
    images = convert_from_path(pdf_path, fmt='png')
    image_path = str(pdf_path).replace(".pdf", ".png")
    
    # Save the first page as PNG (assuming single-page PDF)
    images[0].save(image_path, 'PNG')

    # Run Tesseract on the image to extract text
    text = pytesseract.image_to_string(image_path)
    print("-------EXTRACTED PDF --------")
    print(f"{text}")

    return text

def extract_block_lot(text):
    primary_pattern = r"(?i)Block\s*[: ]\s*(\d+)\s*(?:[^\d]*?)Lots?\s*[: ]\s*(\d+)"
    secondary_pattern = r"(\d{3,4})-(\d{1,2})"
    
    match_primary = re.search(primary_pattern, text)
    if match_primary:
        return match_primary.group(1), match_primary.group(2)
    
    match_secondary = re.search(secondary_pattern, text)
    if match_secondary:
        return match_secondary.group(1), match_secondary.group(2)
    
    return None, None

def convert_to_address(filename):
    # Remove the file extension
    base_name = re.sub(r"\.pdf$", "", filename, flags=re.IGNORECASE)
    
    # Replace hyphens with spaces and capitalize each word
    address = " ".join(word.capitalize() for word in base_name.split('-'))
    
    return address

def main():
    # Load existing foreclosure auctions CSV
    existing_auctions_file = 'transactions/foreclosure_auctions.csv'
    existing_auctions = []
    with open(existing_auctions_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['borough'] == 'Brooklyn':
                existing_auctions.append((row['date'], row['case_number']))
    
    print('Connecting to Scraping Browser...')
    sbr_connection = ChromiumRemoteConnection(SBR_WEBDRIVER, 'goog', 'chrome')
    options = ChromeOptions()
    
    # Set download preferences
    download_dir = tempfile.mkdtemp()
    
    with Remote(sbr_connection, options=options) as driver:
        print('Connected! Navigating...')
        
        driver.get('https://www.nycourts.gov/legacyPDFs/courts/2jd/kings/civil/foreclosures/foreclosure%20scans/')
        print('Navigated! Scraping page content...')

        # Extract the auction date from the link text
        html = driver.page_source
        auction_date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', html)
        if not auction_date_match:
            print(f'No auction date found in {link_text}')
            return
        
        auction_date_str = auction_date_match.group(0)
        auction_date = datetime.strptime(auction_date_str, '%m/%d/%Y').strftime('%Y-%m-%d')
        
        # Find all the PDF links on the page and collect their href attributes and link text
        links = driver.find_elements(By.TAG_NAME, 'a')
        pdf_links = [(link.text, link.get_attribute('href')) for link in links if link.get_attribute('href') and link.get_attribute('href').endswith('.pdf')]
        
        
        for link_text, pdf_url in pdf_links:
            # Check if the auction date already exists in the CSV
            if (auction_date, link_text) in existing_auctions:
                print(f'Auction {auction_date}, {link_text} already exists. Skipping.')
                continue

            print(f'Processing PDF: {pdf_url} (Link text: {link_text})')
            
            # Download the PDF using requests
            subprocess.run(['node', 'scrapers/download_pdf.js', pdf_url])
            
            pdf_path = Path(link_text)
            if pdf_path.exists():
                print(f'Extracting text from: {pdf_path}')
                extracted_text = extract_text_from_pdf(pdf_path)
                
                block, lot = extract_block_lot(extracted_text)
                if not block or not lot:
                    print(f'Block and lot not found in {pdf_path}.')
                    continue
                
                address = convert_to_address(link_text)
                
                # Append data to CSV
                with open(existing_auctions_file, mode='a', newline='', encoding='utf-8') as csv_file:
                    writer = csv.writer(csv_file)
                    writer.writerow(['Brooklyn', auction_date, link_text, address, block, lot])
            else:
                print(f'Failed to download PDF: {pdf_url}')

if __name__ == '__main__':
    main()