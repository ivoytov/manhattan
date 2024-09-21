using CSV, DataFrames, ProgressMeter, Base.Threads


# Get filings
function get_filings()
    log_path = "foreclosures/cases.log"
    not_in_cef = readlines(log_path) |> x -> filter(y -> endswith(y, "Not in CEF"), x) |> x -> map(y -> split(y, " ")[1], x)
    
    cases_path = "foreclosures/cases.csv"
    rows = CSV.read(cases_path, DataFrame)
    filter!(row -> !(row.case_number in not_in_cef), rows)
    sort!(rows, order(:auction_date, rev=true))
    
    p = Progress(nrow(rows))

    # Define the number of concurrent tasks
    max_concurrent_tasks = 12
    task_channel = Channel{Bool}(max_concurrent_tasks)
    
    # Fill the channel with 'true' values to represent available task slots
    for _ in 1:max_concurrent_tasks
        put!(task_channel, true)
    end

    @sync for row in eachrow(rows)
        take!(task_channel)  # Take a task slot (blocks if no slot is available)
        @async begin
            next!(p; showvalues = [("Case #", row.case_number), ("Borough", row.borough), ("Auction Date", row.auction_date)])
            try
                run(`bash -c "source ~/.nvm/nvm.sh && nvm use 20 && node scrapers/notice_of_sale.js $(row.case_number) $(row.borough) $(row.auction_date)"`, wait=false)        
            catch e
                println("Error downloading filings for $(row.case_number) $(row.borough)")
            finally
                put!(task_channel, true)  # Return the task slot
            end
        end
    end
end


# Main function
function main()
    get_filings()
end

main()