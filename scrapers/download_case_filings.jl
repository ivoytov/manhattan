using CSV, DataFrames, ProgressMeter, Base.Threads


# Get filings
function get_filings()
    log_path = "foreclosures/cases.log"
    not_in_cef = readlines(log_path) |> x -> filter(y -> endswith(y, "Not in CEF"), x) |> x -> map(y -> split(y, " ")[1], x)
    
    cases_path = "foreclosures/cases.csv"
    rows = CSV.read(cases_path, DataFrame)
    filter!(row -> !(row.case_number in not_in_cef), rows)
    sort!(rows, order(:auction_date, rev=true))
    
    # Define the number of concurrent tasks
    max_concurrent_tasks = 6
    running_tasks = 0
    tasks = []
    fail_jobs = 0
    
    p = Progress(nrow(rows))
    for row in eachrow(rows)
        next!(p; showvalues = [("Case #", row.case_number), ("Borough", row.borough), ("Auction Date", row.auction_date), ("# active tasks", running_tasks), ("# failed", fail_jobs)])
        while running_tasks >= max_concurrent_tasks
            for (case_number, process) in tasks
                if !success(process)
                    continue
                end
                fail_jobs += process.exitcode
                running_tasks -= 1
                filter!(tsk-> tsk[1] != case_number, tasks)
            end
            sleep(3) # Wait for a slot to be available
        end

        
        tsk = run(`node scrapers/notice_of_sale.js $(row.case_number) $(row.borough) $(row.auction_date)`, wait=false)        
        push!(tasks, (row.case_number, tsk))
        running_tasks += 1
        
    end

    while running_tasks > 0
        for (case_number, process) in tasks
            if !success(process)
                continue
            end
            fail_jobs += process.exitcode
            running_tasks -= 1
            filter!(tsk-> tsk[1] != case_number, tasks)
        end
        sleep(3) # Wait for a slot to be available
    end
    
end


# Main function
function main()
    get_filings()
end

main()