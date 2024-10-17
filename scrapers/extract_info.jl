using CSV, DataFrames, ProgressMeter, OCReract, Dates, Printf

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
    pattern = r"(?:building located at|property located at|(?<!formerly )known as|described as follows:?(?!\s*See|\s*beginning|\s*All that)|(?:prem\.|premises)\s*k\/a|lying and being at|street address of)\s((.+?)(?:,?\s+(N\.?Y\.?|New\s?York(?! Avenue)))(\s+\d{5})?)"i
    return extract_pattern(text, [pattern])
end


# Function to extract block
function extract_block(text)
    patterns = [
        r"\bBlock[:\s]+(\d+)"i, 
        r"SBL\.?:?\s*(\d{3,5})-\d{1,4}"i,
        r"(?<!\(\d{3}\))\s(\d{3,5})-(\d{1,4})[.)]"
    ]
    return extract_pattern(text, patterns)
end

# Function to extract lot
function extract_lot(text)
    patterns = [
        r"\bLot(?:\(?s?\)?| No\.?)[:\s]+(\d+)"i, 
        r"SBL\.?:?\s*(\d{3,5})-\d{1,4}"i,
        r"(?<!\(\d{3}\))\s\d{3,5}-(\d{1,4})[.)]"
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

        # check if this form is for the correct Date
        is_right_date = prompt("Is this form for the auction held on $(foreclosure_case.auction_date) (y/n)?", "n")
        if is_right_date == "n"
            # move the file to a new name
            mv(pdf_path, pdf_path * ".old")
            run(`osascript -e 'tell application "Preview" to close (every document whose name is "$filename")'`)
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
        println("$case_number Error extracting text from $pdf_path: $e")
        return (block=missing, lot=missing, address=missing)
    end
    text = replace(text, "\n" => " ")

    values = (
        block=extract_block(text),
        lot=extract_lot(text),
        address=extract_address(text)
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
    

    # while true
    #     more = prompt("Is there another lot in the auction (y/n)?", "n")
    #     if more == "n"
    #         break
    #     end
    #     new_row = (
    #         case_number=case_number,
    #         borough=foreclosure_case.borough,
    #         block=parse(Int, prompt("Enter block: ", "")),
    #         lot=parse(Int, prompt("Enter lot: ", "")),
    #         address=prompt("Enter address: ", "")
    #     )

    #     push!(lots, new_row)
    # end

    run(`osascript -e 'tell application "Preview" to close window 1'`)
    res = (; (Symbol(k) => v for (k,v) in b)...)
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
        if isnothing(values.block) || isnothing(values.lot)
            if "-i" ∈ ARGS
                values = prompt_for_block_and_lot(pdf_path, values)
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
        @show row
        push!(lots, row)
    end

    # Convert updated rows back to CSV
    CSV.write(lots_path, lots)
    println("CSV file has been updated with missing block and lot values.")
end

function test_existing_data(start_case = nothing)
    lots_path = "foreclosures/lots.csv"
    lots = CSV.read(lots_path, DataFrame)

    # Read in which files exist
    files = readdir("saledocs/noticeofsale") .|> x -> replace(x[1:end-4], "-" => "/")
    
    start_idx = 1
    if !isnothing(start_case)
        printstyled("Starting with case $start_case \n", color=:blue, italic=true)
        start_idx = findfirst(lots.case_number .== start_case) 
    end 

    total = nrow(lots)
    for (idx, case) in enumerate(eachrow(lots))
        idx < start_idx && continue
        case_number = case.case_number

        if case_number ∉ files
            continue
        end
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

        println("$idx/$total $case_number $(case.borough) block: $(case.block) lot:$(case.lot) $(case.address)")
        block, lot=extract_block(text), extract_lot(text)
        address=extract_address(text)

        block = isnothing(block) ? 0 : parse(Int, block)
        lot = isnothing(lot) ? 0 : parse(Int, lot)
        address = isnothing(address) ? "" : address

        if (block == 0 || block == case.block) && 
            (lot == 0 || lot == case.lot) && 
            (isnothing(address) || ismissing(case.address) || address == case.address)
            continue
        end

        # Open the PDF file with the default application on macOS
        run(`open "$pdf_path"`)
        printstyled("\n", text, "\n", italic=true)


        printstyled(@sprintf("%s EXISTING block %6d lot %5d address %s\n", case_number, case.block, case.lot, case.address), color=:light_magenta)
        printstyled(@sprintf("%s NEW      block %6d lot %5d address %s\n", case_number, block, lot, address), color=:light_green)
        
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
    if "-i" ∈ ARGS
        get_auction_results()
    end
end

main()
# test_existing_data()