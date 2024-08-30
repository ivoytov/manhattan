from PyPDF2 import PdfReader
import re
from datetime import datetime
import pandas as pd

# Download the PDF file
doc = PdfReader("webcivil_court_calendar.pdf")

# Extract text from all pages
text = ""
for page in doc.pages:
    text += page.extract_text() + "\n"

# Step 1: Separate the file into chunks by "Friday, August 30, 2024"
date_pattern = r"Friday,\s([A-Z][a-z]+)\s(\d{2}),\s(\d{4})"

date_chunks = re.split(date_pattern, text)
auctions = {}

for i in range(1, len(date_chunks), 4):
    # extract auction date
    date = date_chunks[i:i+3]
    date_obj = datetime.strptime(f"{date[0]} {date[1]} {date[2]}", "%B %d %Y").strftime('%Y-%m-%d')

    # move the preceding two lines into the next chunk
    previous_chunk_lines = date_chunks[i-1].split("\n")
    move_lines = previous_chunk_lines[-2:]
    previous_chunk_trimmed = "\n".join(previous_chunk_lines[:-2])

    # append those lines to our chunk
    current_chunk = "\n".join(move_lines) + "\n" + date_chunks[i+3]
    auctions[date_obj] = current_chunk

cases = []
for date, chunk in auctions.items():
    print(date, chunk.split("\n")[0])
    auction_chunks = re.split(r'(\d{5,6}/\d{4}[A-Z]?)(?:\s-\s)', chunk)
    
    for i in range(1, len(auction_chunks), 2):
        cases.append({
            "borough": "Queens",
            "date": date,
            "case_number": auction_chunks[i],
            "case_name": auction_chunks[i+1].splitlines()[0],
            "block": None,
            "lot": None
        })

df = pd.DataFrame(cases)

# Define the CSV file path (adjust path as needed)
csv_file_path = "transactions/foreclosure_auctions.csv"
existing_df = pd.read_csv(csv_file_path).query("borough == 'Queens'")
existing_df['date'] = pd.to_datetime(existing_df['date']).dt.strftime('%Y-%m-%d')

# Merge the new data into the existing DataFrame
new_sales = pd.concat([existing_df, df]).drop_duplicates(subset=['borough', 'date', 'case_number'], keep=False)

# Save the updated DataFrame back to the CSV file
if not new_sales.empty:
    new_sales.to_csv(csv_file_path, mode='a', header=False, index=False)

# Display the updated DataFrame
print(new_sales)

