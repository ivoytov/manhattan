using CSV, DataFrames, ProgressMeter, Base.Threads, Dates


# Get filings
function get_filings()
    log_path = "foreclosures/cases.log"
    not_in_cef = readlines(log_path) |> x -> filter(y -> endswith(y, "Not in CEF"), x) |> x -> map(y -> split(y, " ")[1], x)
    
    cases_path = "foreclosures/cases.csv"
    rows = CSV.read(cases_path, DataFrame)
    filter!(row -> !(row.case_number in not_in_cef), rows)
    # start_dt = Dates.today() - Dates.Day(0)
    # end_dt = Dates.today() + Dates.Day(14)
    # filter!(row -> start_dt < row.auction_date < end_dt, rows)
    sort!(rows, order(:auction_date))
    
    # Define the number of concurrent tasks
    max_concurrent_tasks = 30
    running_tasks = []
    tasks_list = copy(rows.case_number)
    fail_jobs = 0
    
    p = Progress(length(tasks_list))
    while length(tasks_list) > 0
        while length(running_tasks) >= max_concurrent_tasks
            for (case_number, process) in running_tasks
                if !success(process)
                    continue
                end
                @show process
                fail_jobs += process.exitcode
                filter!(tsk-> tsk[1] != case_number, running_tasks)
            end
            sleep(3) # Wait for a slot to be available
        end

        row = rows[findfirst(rows.case_number .== pop!(tasks_list)), :]
        tsk = run(`node scrapers/notice_of_sale.js $(row.case_number) $(row.borough) $(row.auction_date)`, wait=false) 
        push!(running_tasks, (row.case_number, tsk))
        # println("Starting task $(row.case_number) running tasks $(length(running_tasks))/$max_concurrent_tasks remaining tasks $(length(tasks_list)) failed jobs $fail_jobs") 
        next!(p; showvalues = [("Case #", row.case_number), ("Borough", row.borough), ("Auction Date", row.auction_date), ("# active tasks", length(running_tasks)), ("# failed", fail_jobs)])      

    end 
    
end


# Main function
function main()
    get_filings()
end

main()