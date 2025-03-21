using CSV, DataFrames, ProgressMeter, OCReract, Dates, Printf, OpenAI, Base64, JSON3, DotEnv

DotEnv.load!()

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
            return length(m.captures) > 0 ? m.captures[1] : m
        end
    end
    return nothing
end

# Function to extract address
function extract_address(text)
    patterns = [
        r"(?:premises known(?:\sas)?|(?:building|property) located at)\s((.+?)(?:,?\s+(N\.?Y\.?|New\s?York(?! Avenue)))(\s+\d{5})?)"i,
        r"(?:building located at|property located at|(?<!formerly )\bknown(?:\sas)?|described as follows:?(?!\s*See|\s*beginning|\s*All that)|(?:prem\.|premises)\s*k\/a|lying and being at|street address of)\s((.+?)(?:,?\s+(N\.?Y\.?|New\s?York(?! Avenue)))(\s+\d{5})?)"i,
    ]
    return extract_pattern(text, patterns)
end


# Function to extract block
function extract_block(text)
    patterns = [
        r"\bBlock[:\s]+(\d{1,5})\b"i, 
        r"SBL\.?:?\s*(\d{3,5})-\d{1,4}"i,
        r"(?<!\(\d{3}\))\s(\d{3,5})-(\d{1,4})[.)]"
    ]
    return extract_pattern(text, patterns)
end

# Function to extract lot
function extract_lot(text)
    patterns = [
        r"\bLot(?:\(?s?\)?| No\.?)[:\s]+(\d{1,4})"i, 
        r"SBL\.?:?\s*(\d{3,5})-\d{1,4}"i,
        r"(?<!\(\d{3}\))\s\d{3,5}-(\d{1,4})[.)]"
    ]
    return extract_pattern(text, patterns)
end

function detect_multiple_lots(text)
    patterns = [
        r"\b\d{1,4}\s?(?:&|and)\s?\d{1,4}"i,
        r"\b(lot:? )(\d{1,4}).+?\b(lot:? )(?!(\2))\d{1,4}"i,
        r"\blots?:?\s\d{1,4},\s\d{1,4}"i,
    ]
    return extract_pattern(text, patterns)
end


function detect_time_share(text)
    patterns = [
        r"\bHNY CLUB SUITES\b"i,
        r"\bVACATION SUITES\b"i,
    ]
    return extract_pattern(text, patterns)
end

# Extract text from PDF
function extract_text_from_pdf(pdf_path)
    case_number = basename(pdf_path)[1:end-4]
    image_path = case_number * ".png"
    text_path = case_number # .txt gets appended automatically

    # Call the GraphicsMagick command
    run(pipeline(`gm convert -append -density 330 $pdf_path $image_path`, stdout=devnull, stderr=devnull))

    
    run_tesseract(image_path, text_path, lang="eng", user_defined_dpi=330)
    text = read(text_path, String)
    rm(image_path)
    rm(text_path)
    return text
end

function extract_llm_values(pdf_path)
    case_number = basename(pdf_path)[1:end-4]
    image_path = case_number * ".png"

    # Call the GraphicsMagick command
    run(pipeline(`gm convert -append -density 330 $pdf_path $image_path`, stdout=devnull, stderr=devnull))
    
    # Read the image and encode it to Base64
    image_data = read(image_path)
    rm(image_path)
    base64_image = base64encode(image_data)
    
    provider = OpenAI.OpenAIProvider(
        api_key=ENV["OPENAI_API_KEY"],
    )

    
    r = create_chat(
        provider,
        "gpt-4o-mini",
        [Dict("role" => "user", "content" => [
            Dict("type" => "text", "text" => "I need help extracting the judgment, upset price, and the sale price (winning bid) from this document. Return the answer in JSON format like this: { \"judgement\": 100000, \"upset_price\": 200000, \"winning_bid\": 300000 }"),
            Dict("type" => "image_url", "image_url" => Dict("url" => "data:image/png;base64," * base64_image))
        ])];
        max_tokens = 300,
        response_format = Dict("type" => "json_object")
    )

    parsed_response = r.response[:choices][1][:message][:content] |> JSON3.read

    # Access structured data
    judgement = parsed_response["judgement"]
    upset_price = parsed_response["upset_price"]
    winning_bid = parsed_response["winning_bid"]

    return judgement, upset_price, winning_bid
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
            )
            push!(bids, row; promote=true, cols=:subset)
        end 

        # modifying row from here on will alter the DataFrame
        row = bids[findfirst(bids.case_number .== case_number .&& bids.auction_date .== foreclosure_case.auction_date), :]
        if  (row.judgement, row.upset_price, row.winning_bid) .|> !ismissing |> all
            continue
        end

        # Extract text from PDF manually
        filename = replace(case_number, "/" => "-") * ".pdf"
        pdf_path = joinpath("saledocs/surplusmoney", filename)
        
        judgement, upset_price, winning_bid = missing, missing, missing

        try
            judgement, upset_price, winning_bid = extract_llm_values(pdf_path)
        catch e
            println("Error extracting values from $pdf_path: $e")
        end

        # Open the PDF file with the default application on macOS
        run(`open "$pdf_path"`)

        values = (
            auction_date=foreclosure_case.auction_date,
            judgement=round(judgement),
            upset_price=round(upset_price),
            winning_bid=round(winning_bid)
        )

        # check if this form is for the correct Date
        is_right_date = prompt("Is this form for the auction held on $(foreclosure_case.auction_date) (y/n)?", "n")
        if is_right_date == "n"
            # move the file to a new name
            run(`osascript -e 'tell application "Preview" to close (every document whose name is "$filename")'`)
            rm(pdf_path)
            continue
        elseif isnothing(is_right_date) 
            run(`osascript -e 'tell application "Preview" to close (every document whose name is "$filename")'`)
            return bids
        end

        # Iterate through values and update them
        for (key, parsed_value) in pairs(values)
            key == :auction_date && continue

            if !ismissing(row[key])
                prompt_value = row[key]
            elseif isnothing(parsed_value) || ismissing(parsed_value)
                prompt_value = ""
            else
                prompt_value = parsed_value
            end

            input = prompt("Enter $key:", prompt_value)
            if input === nothing
                run(`osascript -e 'tell application "Preview" to close (every document whose name is "$filename")'`)
                return bids
            end
            if input == "s"
                run(`osascript -e 'tell application "Preview" to close (every document whose name is "$filename")'`)
                continue
            end
            row[key] = key == :auction_date ? Date(input, "yyyy-mm-dd") : parse(Float64, input)
        end

        run(`osascript -e 'tell application "Preview" to close window 1'`)
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

notice_of_sale_path(case_number) = joinpath("saledocs/noticeofsale", replace(case_number, "/" => "-") * ".pdf")

# Extract block/lot/address from file
function parse_notice_of_sale(pdf_path)
    # Extract text from PDF
    text = try
        extract_text_from_pdf(pdf_path)
    catch e
        println("Error extracting text from $pdf_path: $e")
        return missing
    end
    text = replace(text, "\n" => " ")
    values = (
        block=extract_block(text),
        lot=extract_lot(text),
        address=extract_address(text),
        is_combo=detect_multiple_lots(text),
        is_timeshare=detect_time_share(text),
    )
    return values
end

# Prompt for block and lot
function prompt_for_block_and_lot(pdf_path, values)
    # Open the PDF file with the default application on macOS
    run(`open "$pdf_path"`)
    # Iterate through values and update them
    res = Dict()
    for (key, parsed_value) in pairs(values)
        if parsed_value === nothing
            prompt_value = ""
        else
            prompt_value = parsed_value
        end

        input = prompt("Enter $key:", prompt_value)
        if isnothing(input) || ismissing(input) || input == "s" 
            return nothing
        end
        res[key] = input
    end

    run(`osascript -e 'tell application "Preview" to close window 1'`)
    res = (; (Symbol(k) => v for (k,v) in res)...)
    return res
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

    new_cases = antijoin(cases, lots, on=:case_number)

    for case in eachrow(new_cases)
        pdf_path = notice_of_sale_path(case.case_number)
        values = parse_notice_of_sale(pdf_path)
        ismissing(values) && continue

        if !isnothing(values.is_timeshare)
            println("$(case.case_number) Timeshare detected")
            row = (
                case_number=case.case_number, 
                borough=case.borough, 
                block=1006, 
                lot=1302,
                address= missing
            )
            push!(lots, row; cols=:subset)
            continue
        end

        if !isnothing(values.is_combo)
            println("$(case.case_number) Possible combo lot")
        end
        if isnothing(values.block) || isnothing(values.lot)
            if "-i" ∈ ARGS || haskey(ENV, "WSS")
                values = prompt_for_block_and_lot(pdf_path, values)
                isnothing(values) && break
            else
                continue
            end
        end
        row = (
            case_number=case.case_number, 
            borough=case.borough, 
            block=parse(Int,values.block), 
            lot=parse(Int, values.lot), 
            address=isnothing(values.address) ? missing : values.address
        )
        printstyled(@sprintf("%12s block %6d lot %5d address %s\n", row.case_number, row.block, row.lot, ismissing(row.address) ? "missing" : row.address), color=:light_green)
        push!(lots, row; cols=:subset)
    end

    # Convert updated rows back to CSV
    CSV.write(lots_path, lots)
    println("CSV file has been updated with missing block and lot values.")
end

function test_existing_data(start_case = nothing)
    lots_path = "foreclosures/lots.csv"
    lots = CSV.read(lots_path, DataFrame)

    combo_cases = unique(lots[nonunique(lots, [:case_number]), :case_number])
    # don't try to check cases with > 1 parcel as the regex will fail
    filter!(:case_number => ∉(combo_cases), lots)

    # Read in which files exist
    files = readdir("saledocs/noticeofsale") .|> x -> replace(x[1:end-4], "-" => "/")
    
    start_idx = 1
    if !isnothing(start_case)
        printstyled("Starting with case $start_case \n", color=:blue, italic=true)
        start_idx = findfirst(lots.case_number .== start_case) 
    end 

    total = nrow(lots)
    for (idx, case) in enumerate(eachrow(lots[start_idx:end, :]))
        case_number = case.case_number

        if case_number ∉ files
            continue
        end
        # Extract text from PDF
        pdf_path = notice_of_sale_path(case_number)
        values = parse_notice_of_sale(pdf_path)

        println(@sprintf("%4d/%4d %12s block %5d-%4d %s", start_idx + idx - 1, total, case_number, case.block, case.lot, case.address))

        ismissing(values) && continue
        block = isnothing(values.block) ? 0 : parse(Int, values.block)
        lot = isnothing(values.lot) ? 0 : parse(Int, values.lot)
        address = isnothing(values.address) ? "" : values.address
        is_combo = isnothing(values.is_combo) ? "" : "COMBO"

        if (block == 0 || block == case.block) && 
            (lot == 0 || lot == case.lot) && 
            # (address == "" || ismissing(case.address) || address == case.address) &&
            (is_combo != "COMBO")
            continue
        end

        run(`open "$pdf_path"`)
        # Open the PDF file with the default application on macOS
        if is_combo == "COMBO"
            printstyled("$case_number COMBO detected\n", bold=true, color=:yellow)
            continue
        end

        printstyled(@sprintf("%12s EXISTING block %6d lot %5d address %s\n", case_number, case.block, case.lot, case.address), color=:light_magenta)
        printstyled(@sprintf("%12s NEW      block %6d lot %5d address %s %s\n", case_number, block, lot, address, is_combo), color=:light_green)
        
        is_fix = prompt("Change EXISTING to NEW (y/n)?", "n")
        if isnothing(is_fix)
            break
        elseif is_fix == "y"
            lots.block[idx] = block
            lots.lot[idx] = lot
            lots.address[idx] = address
        end
        run(`osascript -e 'tell application "Preview" to close window 1'`)


    end

    CSV.write(lots_path, lots)
    println("CSV file has been updated with missing block and lot values.")
end


# Main function
function main()
    get_block_and_lot()
    if "-i" ∈ ARGS || haskey(ENV, "WSS")
        get_auction_results()
    end
end

main()
# test_existing_data("722814/2021")