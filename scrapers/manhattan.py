import subprocess
import requests
from io import BytesIO
from PyPDF2 import PdfReader
import re
from datetime import datetime
import os
import pandas as pd

# Set up headers
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15"
}

# Download the PDF file
pdf_url = "https://www.nycourts.gov/legacypdfs/courts/1jd/supctmanh/foreclosures/auctions.pdf"
subprocess.run(['node', 'scrapers/download_pdf.js', pdf_url])

doc = PdfReader("auctions.pdf")

# Extract text from all pages
all_text = ""
for page in doc.pages:
    all_text += page.extract_text() + "\n"

# Function to extract the date, case numbers, and case names
def parse_court_data(data):
    # Extract the auction date
    date_regex = r"\s+(\w+\s+\d{1,2},\s+\d{4})"
    date_match = re.search(date_regex, data)
    auction_date = datetime.strptime(date_match.group(1), "%B %d, %Y").date()

    # Extract case numbers and case names
    case_regex = r"(\d+/\d+)\s+-\s+(.+?)\s+vs\.\s+(.+)"
    case_matches = re.findall(case_regex, data)
    
    case_numbers = [match[0] for match in case_matches]
    case_names = [f"{match[1]} vs. {match[2]}" for match in case_matches]

    return auction_date, case_numbers, case_names

# Parse the court data
auction_date, case_numbers, case_names = parse_court_data(all_text)

# Print the results
print("Auction Date:", auction_date)
print("Case Numbers:", case_numbers)
print("Case Names:", case_names)

# Create data to be written to CSV file
# borough,date,case_number,case_name,block,lot
data = {
    "borough": ["Manhattan"] * len(case_numbers),
    "date": [auction_date] * len(case_numbers),
    "case_number": case_numbers,
    "case_name": case_names,
    "block": ["" for _ in case_numbers],
    "lot": ["" for _ in case_numbers],
}

df = pd.DataFrame(data)

# Define the CSV file path (adjust path as needed)
csv_file_path = "transactions/foreclosure_auctions.csv"

def csv_has_date(file_path, date):
    if not os.path.isfile(file_path):
        return False
    df_existing = pd.read_csv(file_path)
    return any((df_existing['date'] == date) & (df_existing['borough'] == "Manhattan"))

# Check if the CSV file has the date
if csv_has_date(csv_file_path, auction_date):
    print(f"Data with date {auction_date} already exists in {csv_file_path}")
else:
    # Append the new data to the CSV file if the date is not present
    df.to_csv(csv_file_path, mode='a', header=not os.path.isfile(csv_file_path), index=False)
    print(f"Data successfully appended to {csv_file_path}")