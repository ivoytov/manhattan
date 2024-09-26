using CSV, DataFrames, ProgressMeter, Base.Threads, Dates


# Get filings
function get_filings()
    log_path = "foreclosures/cases.log"
    not_in_cef = readlines(log_path) |> 
                x -> filter(y -> endswith(y, "Not in CEF") || endswith(y, "Discontinued"), x) |> 
                x -> map(y -> split(y, " ")[1], x)
    
    cases_path = "foreclosures/cases.csv"
    rows = CSV.read(cases_path, DataFrame)
    filter!(row -> !(row.case_number in not_in_cef), rows)
    
    sort!(rows, order(:auction_date))

    start_dt = Dates.today() - Dates.Day(0)
    end_dt = Dates.today() + Dates.Day(14)
    urgent_cases = filter(rows) do row
        is_soon = start_dt < row.auction_date < end_dt 
        filename = replace(row.case_number, "/" => "-")
        has_notice_of_sale = isfile("saledocs/noticeofsale/$filename.pdf")
        return is_soon && !has_notice_of_sale
    end
    for case in eachrow(urgent_cases)

        println("$(case.case_number) $(case.borough) $(case.auction_date)")
    end
    
    p = Progress(nrow(rows))
    Threads.@threads :dynamic for row in eachrow(rows)
            next!(p; showvalues = [("Case #", row.case_number), ("Borough", row.borough), ("Auction Date", row.auction_date)])
            try
                run(pipeline(`node scrapers/notice_of_sale.js $(row.case_number) $(row.borough) $(row.auction_date)`, devnull))
            catch e
                println("Error downloading filings for $(row.case_number) $(row.borough)")
        end
    end
    
end


# Main function
function main()
    get_filings()
end

main()