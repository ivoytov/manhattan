using CSV, DataFrames, ProgressMeter, OCReract, Dates

# Function to prompt with a default answer
function prompt(question, default_answer="")
    print("$question [$default_answer]: ")
    input = readline()
    input == "q" && return nothing
    return input == "" ? "$default_answer" : input
end

# Function to extract matches based on a pattern
function extract_pattern(text, patterns)
    for pattern in patterns
        m = match(pattern, text)
        if m !== nothing
            return m.captures[1]
        end
    end
    return nothing
end

# Function to extract address
function extract_address(text)
    pattern = r"(?:premises known as\s|prem\.\s*k\/a\s|lying and being at\s)([\sa-z,\-0-9]+(?:,?\s+(NY|New York)(\s+\d{5})?)?)"i
    return extract_pattern(text, [pattern])
end

# Function to extract block
function extract_block(text)
    patterns = [r"Block[:\s]+(\d+)"i, r"\s(\d{3,5})-(\d{1,4})[\.\s]"]
    return extract_pattern(text, patterns)
end

# Function to extract lot
function extract_lot(text)
    patterns = [r"\sLots?[:\s]+(\d+)"i, r"\s\d{3,5}-(\d{1,4})[\.\s]"]
    return extract_pattern(text, patterns)
end

# Extract text from PDF
function extract_text_from_pdf(pdf_path)
    case_number = basename(pdf_path)[1:end-4]
    image_path = case_number * ".png"
    text_path = case_number * ".txt"

    # Call the GraphicsMagick command
    run(`bash -c "gm convert -density 330 $pdf_path $image_path > /dev/null 2>&1"`)

    run_tesseract(image_path, text_path)
    text = read(text_path, String)
    rm(image_path)
    rm(text_path)
    return text
end

# Prompt for winning bid
function prompt_for_winning_bid(cases, bids)
    # p = Progress(nrow(cases))
    for foreclosure_case in eachrow(cases)
        case_number = foreclosure_case.case_number
        if foreclosure_case.auction_date > today()
            continue
        end
        
        if isnothing(findfirst(bids.case_number .== case_number .&& bids.auction_date .== foreclosure_case.auction_date))
            row = (
                case_number=case_number, 
                borough=foreclosure_case.borough, 
                auction_date=foreclosure_case.auction_date,
                judgement=missing,
                upset_price=missing,
                winning_bid=missing
            )
            push!(bids, row)
        end 

        # modifying row from here on will alter the DataFrame
        row = bids[findfirst(bids.case_number .== case_number .&& bids.auction_date .== foreclosure_case.auction_date), :]
        if  (row.judgement, row.upset_price, row.winning_bid) .|> !ismissing |> all
            continue
        end


        println("$case_number $(foreclosure_case.borough) $(foreclosure_case.auction_date)")

        # Extract text from PDF manually
        filename = replace(case_number, "/" => "-") * ".pdf"
        pdf_path = joinpath("saledocs/surplusmoney", filename)

        # Open the PDF file with the default application on macOS
        run(`open "$pdf_path"`)

        values = (
            auction_date=foreclosure_case.auction_date,
            judgement=missing,
            upset_price=missing,
            winning_bid=missing
        )

        # Iterate through values and update them
        for (key, parsed_value) in pairs(values)
            if !ismissing(row[key])
                prompt_value = row[key]
            elseif isnothing(parsed_value) || ismissing(parsed_value)
                prompt_value = ""
            else
                prompt_value = parsed_value
            end

            input = prompt("Enter $key:", prompt_value)
            if input === nothing
                return bids
            end
            if input == "s"
                continue
            end
            row[key] = key == :auction_date ? Date(input, "yyyy-mm-dd") : parse(Float64, input)
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
    files = readdir("saledocs/surplusmoney") .|> x -> replace(x[1:end-4], "-" => "/")

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

        if case_number ∉ lots.case_number
            row = (case_number=case_number, borough=foreclosure_case.borough, block=missing, lot=missing, address=missing)
            push!(lots, row)
        end 
        # modifying row from here on will alter the DataFrame
        row = lots[findfirst(==(case_number), lots.case_number), :]

        if (row.block, row.lot) .|> !ismissing |> all
            continue
        end

        println("$case_number $(foreclosure_case.borough) $(foreclosure_case.auction_date)")

        # Extract text from PDF
        filename = replace(case_number, "/" => "-") * ".pdf"
        pdf_path = joinpath("saledocs/noticeofsale", filename)

        # Extract block and lot
        text = try
            extract_text_from_pdf(pdf_path)
        catch e
            println("$case_number Error extracting text from $pdf_path: $e")
            continue
        end
        text = replace(text, "\n" => " ")

        # Open the PDF file with the default application on macOS
        run(`open "$pdf_path"`)

        values = (
            block=extract_block(text),
            lot=extract_lot(text),
            address=extract_address(text)
        )

        # Iterate through values and update them
        for (key, parsed_value) in pairs(values)
            if !ismissing(row[key])
                prompt_value = row[key]
            elseif parsed_value === nothing
                prompt_value = ""
            else
                prompt_value = parsed_value
            end

            input = prompt("Enter $key:", prompt_value)
            if isnothing(input) || ismissing(input)
                return lots
            end
            if input == "s"
                continue
            end
            row[key] = key == :address ? input : parse(Int, input)
        end
        

        while true
            more = prompt("Is there another lot in the auction (y/n)?", "n")
            if more == "n"
                break
            end
            new_row = (
                case_number=case_number,
                borough=foreclosure_case.borough,
                block=parse(Int, prompt("Enter block: ", "")),
                lot=parse(Int, prompt("Enter lot: ", "")),
                address=prompt("Enter address: ", "")
            )

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
    files = readdir("saledocs/noticeofsale") .|> x -> replace(x[1:end-4], "-" => "/")

    filter!(row -> row.case_number in files, cases)
    sort!(cases, order(:auction_date, rev=true))

    updated_lots = prompt_for_block_and_lot(cases, lots)

    # Convert updated rows back to CSV
    CSV.write(lots_path, updated_lots)

    println("CSV file has been updated with missing block and lot values.")
end


# Main function
function main()
    get_block_and_lot()
    get_auction_results()
end

main()