import subprocess
from PyPDF2 import PdfReader
import re
from datetime import datetime
import os
import pandas as pd

# Download the PDF file
pdf_url = 'https://www.nycourts.gov/LegacyPDFS/courts/12jd/bronx/civil/pdfs/foreclosure-auctions.pdf'
subprocess.run(['node', 'scrapers/download_pdf.js', pdf_url])
doc = PdfReader("foreclosure-auctions.pdf")

# Extract text from all pages
all_text = ""
for page in doc.pages:
    all_text += page.extract_text() + "\n"

import re

def extract_auctions(text):
    # Step 1: Separate the file into chunks by "Calendar Date: MM/DD/YYYY"
    date_chunks = re.split(r'\bCalendar Date:\s+\d{1,2}/\d{1,2}/\d{4}\b', text)

    # Dictionary to store the extracted data
    auctions = []

    for date_chunk in date_chunks[1:]:  # Skip the first chunk which is before the first "Calendar Date:"
        # Find the date in the chunk (we assume it's in the format "Calendar: MM/DD/YYYY")
        date_match = re.search(r'\bCalendar:\s+(\d{1,2}[./]\d{1,2}[./]\d{4})\b', date_chunk)
        if not date_match:
            continue
        calendar_date = date_match.group(1)
        calendar_date = datetime.strptime(calendar_date, '%m/%d/%Y').strftime('%Y-%m-%d')
        
        # Step 2: Subdivide each date chunk by lines starting with "2:15 PM"
        property_chunks = re.split(r'\b2:15 PM', date_chunk)
        
        for property_chunk in property_chunks[1:]:  # Skip the first chunk before the first "2:15 PM"
            # Step 3: Extract required fields
            index_number = re.search(r'Index #:\s+(\d{5,6}/\d{4}[A-Z]?)', property_chunk)
            remarks = re.search(r'Remarks[\s:;]+(?:Premises[\s:;]+)?(.+)', property_chunk)
            block = re.search(r'\Block[\s:;]*(\d+)\b', property_chunk, re.IGNORECASE)
            lot = re.search(r'\bLot[\s:;]*(\d+)\b', property_chunk, re.IGNORECASE)

            # Store the extracted information
            auction_data = {
                "borough": "Bronx",
                "date": calendar_date,
                "case_number": index_number.group(1) if index_number else None,
                "case_name": remarks.group(1) if remarks else None,
                "block": int(block.group(1)) if block else None,
                "lot": int(lot.group(1)) if lot else None,
            }
            auctions.append(auction_data)
    
    return auctions


auction_data = extract_auctions(all_text)
df = pd.DataFrame(auction_data)

# Define the CSV file path (adjust path as needed)
csv_file_path = "transactions/foreclosure_auctions.csv"
existing_df = pd.read_csv(csv_file_path).query("borough == 'Bronx'")
existing_df['date'] = pd.to_datetime(existing_df['date']).dt.strftime('%Y-%m-%d')


# Merge the new data into the existing DataFrame
new_sales = pd.concat([existing_df, df]).drop_duplicates(subset=['borough', 'date', 'case_number'], keep=False)

# Save the updated DataFrame back to the CSV file
if not new_sales.empty:
    new_sales.to_csv(csv_file_path, mode='a', header=False, index=False)

# Display the updated DataFrame
print(new_sales)