using Dates, HTTP, HTMLForge, Downloads, AbstractTrees, Base.Filesystem, DataFrames, CSV

csv_file_path = "transactions/foreclosure_auctions.csv"

function next_wednesday(date::Date)::Date
    # Get the day of the week for the given date
    day_of_week = dayofweek(date)
    
    # Calculate the number of days until the next Wednesday
    # In the Dates.DayOfWeek type, Wednesday is represented by 3
    days_until_wednesday = (3 - day_of_week + 7) % 7
    
    # If the given date is already Wednesday, we want the next one
    if days_until_wednesday == 0
        days_until_wednesday = 7
    end
    
    # Add the calculated number of days to the given date
    return date + Day(days_until_wednesday)
end

function get_auction_date()
    url = "https://ww2.nycourts.gov/courts/2jd/kings/civil/foreclosuresales.shtml"
    response = HTTP.get(url)
    html_content = String(response.body)

    # Define a regex pattern to match the date
    date_pattern = r"(?i)(\b\w+\b) (\d{1,2}), (\d{4})"

    # Find the date in the input string
    match = match(date_pattern, html_content)

    if match !== nothing
        # Extract matched components
        month_str = match.captures[1]
        day_str = match.captures[2]
        year_str = match.captures[3]
        
        # Convert to Date
        date = Date("$year_str-$month_str-$day_str", dateformat"Y-U-d")
        date = next_wednesday(date)
        println(date)
        return date
    end
    println("No date found.")
    return nothing
end



host = "https://www.nycourts.gov" 
url = "$host/legacyPDFs/courts/2jd/kings/civil/foreclosures/foreclosure%20scans/"


    
   
response = HTTP.get(url, headers=headers)

html_content = String(response.body)
parsed_html = parsehtml(html_content)
auction_date = Date(match(r"\d{1,2}/\d{1,2}/\d{4}", text(parsed_html.root)).match, dateformat"m/d/Y")

# # Check if the CSV file has the date
if csv_has_date(csv_file_path, auction_date)
    println("Data with date ", auction_date, " already exists in ", csv_file_path)
    exit()
end

function convert_to_address(filename::String)
    # Remove the file extension
    base_name = replace(filename, r"\.pdf$" => "")

    # Replace hyphens with spaces and capitalize each word
    address = join(split(base_name, '-'), ' ')
    
    return address
end

links = []
for link in PreOrderDFS(parsed_html.root) 
    if link isa HTMLElement && tag(link) == :a && haskey(attrs(link), "href") && endswith(attrs(link)["href"], ".pdf")
        push!(links, Dict(:address => convert_to_address(string(text(link))), :short_url => string(text(link)), :url => host * attrs(link)["href"]))
    end
end
function extract_text_from_pdf(pdf_path::String, txt_path::String)
    # Convert the PDF to a PNG image using pdftoppm
    image_path = replace(pdf_path, ".pdf" => ".png")
    run(`pdftoppm -singlefile -png $pdf_path $(replace(pdf_path, ".pdf" => ""))`)

    # Run Tesseract on the image to extract text
    run(`tesseract $image_path $txt_path`)

    # Read and return the extracted text
    return read(txt_path * ".txt", String)
end


# Regex pattern to match Block and Lot numbers
primary_pattern = r"(?i)Block\s*[: ]\s*(\d+)\s*(?:[^\d]*?)Lot\s*[: ]\s*(\d+)"
secondary_pattern = r"(\d{3,4})-(\d{1,2})"

# Function to extract Block and Lot numbers using regex
function extract_block_lot(text)
    m = match(primary_pattern, text)
    if m !== nothing
        return (m.captures[1], m.captures[2])
    end

    m = match(secondary_pattern, text)
    if m !== nothing
        return (m.captures[1], m.captures[2])
    end

    return nothing
end

# Create a DataFrame to store the data
df = DataFrame(borough=String[], date=Date[], case_number=Any[], case_name=String[], block=Any[], lot=Any[])


for (i, item) in enumerate(links)
    local url = item[:url]
    idx = Nothing
    block = Nothing
    lot = Nothing
    
    pdf_path = "file_$i.pdf"
    txt_path = "file_$i"

    Downloads.download(url, pdf_path)

    extracted_text = extract_text_from_pdf(pdf_path, txt_path)
    result = extract_block_lot(extracted_text)
    if result !== nothing
        block, lot = result
        println("$i Block: $block, Lot: $lot")
    else
        println("Failed to get block and lot at url $url")
        println(extracted_text)
    end
    local data = ("Brooklyn", auction_date, item[:short_url], item[:address], block, lot)
    
    push!(df, data)
    
    rm(txt_path * ".txt")
    rm(txt_path * ".png")
    rm(pdf_path)
end

# Write the DataFrame to the CSV file
if !isfile(csv_file_path)
    CSV.write(csv_file_path, df, append=false) # Create new file with header
else
    CSV.write(csv_file_path, df, append=true)  # Append to existing file
end

function csv_has_date(file_path::String, date::Date)::Bool
    return !isfile(file_path) || any(row -> row.date == date, CSV.File(file_path))
end