using PDFIO, Downloads, Dates, CSV, DataFrames

headers = Dict(
        "User-Agent" =>  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15"
)

filename = Downloads.download("https://www.nycourts.gov/legacypdfs/courts/1jd/supctmanh/foreclosures/auctions.pdf", headers=headers)
doc = PDFIO.pdDocOpen(filename)
buf = IOBuffer()
PDFIO.pdPageExtractText(buf, PDFIO.pdDocGetPage(doc, 1))
txt = String(take!(buf))

# Define a function to extract the date, case numbers, and case names
function parse_court_data(data::String)
    # Extract the auction date
    date_regex = r"\s+(\w+\s+\d{1,2},\s+\d{4})"
    date_match = match(date_regex, data)
    auction_date = Date(date_match[1], "U d, yyyy")

    # Extract case numbers and case names
    case_regex = r"(\d+/\d+)\s+-\s+(.+?)\s+vs\.\s+(.+)"
    case_matches = eachmatch(case_regex, data)
    
    case_numbers = [match.captures[1] for match in case_matches]
    case_names = [match.captures[2] * " vs. " * match.captures[3] for match in case_matches]

    return auction_date, case_numbers, case_names
end

# Parse the court data
auction_date, case_numbers, case_names = parse_court_data(txt)

# Print the results
println("Auction Date: ", auction_date)
println("Case Numbers: ", case_numbers)
println("Case Names: ", case_names)

# Create data to be written to CSV file
data = DataFrame(borough = repeat(["Manhattan"], length(case_numbers)),
                 date = repeat([auction_date], length(case_numbers)),
                 case_number = case_numbers,
                 case_name = case_names,
                 lot = repeat([""], length(case_numbers)),
                 block = repeat([""], length(case_numbers)),
                 address = repeat([""], length(case_numbers)),)

# Define the CSV file path (adjust path as needed)
csv_file_path = "transactions/foreclosure_auctions.csv"

function csv_has_date(file_path::String, date::Date)::Bool
    return !isfile(file_path) || any(row -> row.date == date && row.borough == "Brooklyn", CSV.File(file_path))
end

# # Check if the CSV file has the date
if csv_has_date(csv_file_path, auction_date)
    println("Data with date ", auction_date, " already exists in ", csv_file_path)
else
    # Append the new data to the CSV file if the date is not present
    if isfile(csv_file_path)
        CSV.write(csv_file_path, data, append=true)
    else
        CSV.write(csv_file_path, data)
    end
    println("Data successfully appended to ", csv_file_path)
end