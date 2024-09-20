using CSV, DataFrames, ProgressMeter, OCReract

# Function to prompt with a default answer
function prompt(question, default_answer="")
    print("$question [$default_answer]: ")
    input = readline()
    input == "q" && return nothing
    return input == "" ? "$default_answer" : input
end


function extract_address(text)
    text = replace(text, "\n"=>" ")
    pattern = r"premises known as\s|prem\.\s*k\/a\s|lying and being at\s([\s\S]*?)(\s+(NY|New York)(\s+\d{5})?)"
    m = match(pattern, text)
    if m !== nothing
        return m.captures[1]
    else
        return nothing
    end
end

# Extract block from text
function extract_block(text)
    block_pattern = r"Block[:\s]+(\d+)"
    combined_pattern = r"\s(\d{3,5})-(\d{1,4})[\.\s]"
    match_block = match(block_pattern, text)
    if match_block !== nothing
        return match_block.match[1]
    end
    match_combined = match(combined_pattern, text)
    if match_combined !== nothing
        return match_combined.match[1]
    end
    return nothing
end

# Extract lot from text
function extract_lot(text)
    lot_pattern = r"\sLots?[:\s]+(\d+)"
    combined_pattern = r"\s(\d{3,5})-(\d{1,4})[\.\s]"
    match_lot = match(lot_pattern, text)
    if match_lot !== nothing
        return match_lot.match[1]
    end
    match_combined = match(combined_pattern, text)
    if match_combined !== nothing
        return match_combined.match[2]
    end
    return nothing
end

# Extract text from PDF
function extract_text_from_pdf(pdf_path)
    case_number = basename(pdf_path)[1:end-4]
    image_path = case_number * ".png"
    text_path = case_number * ".txt"

    # Call the GraphicsMagick command
    run(`gm convert -density 330 $pdf_path $image_path`)

    run_tesseract(image_path, text_path)
    text = read(text_path, String)
    rm(image_path)
    rm(text_path)
    return text
end

# Prompt for winning bid
function prompt_for_winning_bid(cases, bids)
    p = Progress(nrow(cases))
    for foreclosure_case in eachrow(cases)
        case_number = foreclosure_case.case_number
        next!(p; showvalues = [("case #", case_number), ("date", foreclosure_case.auction_date)])
        
        rows = subset(bids, :case_number => x -> x .== case_number)
        if isempty(rows)
            row = Dict(:case_number => case_number, :borough => foreclosure_case.borough, :auction_date => foreclosure_case.auction_date)
            push!(bids, row)
        else 
            row = rows[1, :]
        end
        
        if all(!ismissing(row[j]) for j in ["judgement", "upset_price", "winning_bid", "auction_date"])
            continue
        end
        
        println("$case_number $(foreclosure_case.borough) $(foreclosure_case.auction_date)")
        
        # Extract text from PDF manually
        filename = replace(case_number, "/", "-") * ".pdf"
        dir = "saledocs/surplusmoney"
        pdf_path = joinpath(dir, filename)
        
        # Open the PDF file with the default application on macOS
        run(`open "$pdf_path"`)
        
        for key in ["judgement", "upset_price", "winning_bid", "auction_date"]
            input = prompt("Enter $key:", get(row, key, ""))
            if input == ""
                return bids
            end
            row[key] = key == "auction_date" ? input : parse(Float64, input)
        end
        
        run(`osascript -e 'tell application "Preview" to close (every document whose name is "$filename")'`)
    end
    return bids
end

# Get auction results
function get_auction_results()
    # Read the cases file
    cases = CSV.read("foreclosures/cases.csv", DataFrame)
    bids_path = "foreclosures/bids.csv"
    bids = CSV.read(bids_path, DataFrame)
    
    # Read in which files exist
    files = readdir("saledocs/surplusmoney") .|> x->replace(x[1:end-4], "-"=> "/")
    
    filter!(row -> row.case_number in files, cases)
    sort!(cases, order(:auction_date, rev=true))
    
    updated_bids = prompt_for_winning_bid(cases, bids)
    
    # Convert updated rows back to CSV
    CSV.write(bids_path, updated_bids)
    
    println("CSV file bids.csv has been updated with missing bid results values.")
end

# Prompt for block and lot
function prompt_for_block_and_lot(cases, lots)
    for foreclosure_case in eachrow(cases)
        case_number = foreclosure_case.case_number
        
        rows = subset(lots, :case_number => x -> x .== case_number)
        if isempty(rows)
            row = Dict(:case_number => case_number, :borough => foreclosure_case.borough)
            push!(lots, row)
        else 
            row = rows[1, :]
        end
        
        if all(!ismissing(row[j]) for j in ["block", "lot"])
            continue
        end
        
        println("$case_number $(foreclosure_case.borough) $(foreclosure_case.auction_date)")
        
        # Extract text from PDF
        filename = replace(case_number, "/" => "-") * ".pdf"
        dir = "saledocs/noticeofsale"
        pdf_path = joinpath(dir, filename)
        
        # Extract block and lot
        text = try
            extract_text_from_pdf(pdf_path)
        catch e
            println("$case_number Error extracting text from $pdf_path: $e")
            continue
        end
        
        block = extract_block(text)
        lot = extract_lot(text)
        address = extract_address(text)
        
        # Open the PDF file with the default application on macOS
        run(`open "$pdf_path"`)
        
        values = [("block", block), ("lot", lot)]
        if address !== nothing
            push!(values, ("address", address))
        end
        
        # Iterate through values and update them
        for (key, parsed_value) in values
            prompt_value = get(row, key, parsed_value === nothing ? "" : parsed_value)
            input = prompt("Enter $key:", prompt_value)
            if input === nothing
                return lots
            end
            if input == "s"
                continue
            end
            row[key] = key == "address" ? input : parse(Int, input)
        end
        
        while true
            more = prompt("Is there another lot in the auction (y/n)?", "n")
            if more == "n"
                break
            end
            new_row = Dict("case_number" => case_number, "borough" => foreclosure_case.borough)
            new_row["block"] = parse(Int, prompt("Enter block: ", ""))
            new_row["lot"] = parse(Int, prompt("Enter lot: ", ""))
            new_row["address"] = prompt("Enter address: ", "")
            push!(lots, new_row)
        end
        
        run(`osascript -e 'tell application "Preview" to close (every document whose name is "$filename")'`)
    end
    return lots
end

# Get block and lot
function get_block_and_lot()
    # Read the cases file
    cases = CSV.read("foreclosures/cases.csv", DataFrame)
    lots_path = "foreclosures/lots.csv"
    lots = CSV.read(lots_path, DataFrame)
    
    # Read in which files exist
    files = readdir("saledocs/noticeofsale") .|> x->replace(x[1:end-4], "-"=> "/")
    
    filter!(row -> row.case_number in files, cases)
    sort!(cases, order(:auction_date, rev=true))
    
    updated_lots = prompt_for_block_and_lot(cases, lots)
    
    # Convert updated rows back to CSV
    CSV.write(lots_path, updated_lots)
    
    println("CSV file has been updated with missing block and lot values.")
end


# Get filings
function get_filings()
    log_path = "foreclosures/cases.log"
    not_in_cef = readlines(log_path) |> x -> filter(y -> endswith(y, "Not in CEF"), x) |> x -> map(y -> split(y, " ")[1], x)
    
    cases_path = "foreclosures/cases.csv"
    rows = CSV.read(cases_path, DataFrame)
    filter!(row -> !(row.case_number in not_in_cef), rows)
    sort!(rows, order(:auction_date, rev=true))
    
    p = Progress(nrow(rows))
    for row in eachrow(rows)
        next!(p; showvalues = [("Case #", row.case_number), ("Borough", row.borough), ("Auction Date", row.auction_date)])
        try
            run(`bash -c "source ~/.nvm/nvm.sh && { nvm use 20 > /dev/null; } && node scrapers/notice_of_sale.js $(row.case_number) $(row.borough) $(row.auction_date) > /dev/null 2>&1"`)        
        catch e
            println("Error downloading filings for $(row.case_number) $(row.borough)")
        end
    end
end

# Main function
function main()
    get_filings()
    get_block_and_lot()
    get_auction_results()
end

main()