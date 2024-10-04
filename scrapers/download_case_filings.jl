using CSV, DataFrames, ProgressMeter, Base.Threads, Dates, Random


# Get filings
function get_filings()
    rows = get_data()
    process_data(rows, 4, "--progress" in ARGS)
end

function get_data()
    log_path = "foreclosures/cases.log"
    not_in_cef = readlines(log_path) |> 
                x -> filter(y -> endswith(y, "Not in CEF") || endswith(y, "Discontinued") || endswith(y, "No PDF version"), x) |> 
                x -> map(y -> split(y, " ")[1], x)
    
    cases_path = "foreclosures/cases.csv"
    rows = CSV.read(cases_path, DataFrame)
    filter!(row -> !(row.case_number in not_in_cef), rows)
    
    sort!(rows, order(:auction_date), rev=true)

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

	return rows
end


function process_data(rows, max_concurrent_tasks, show_progress_bar=false)
	tasks = Task[]
	channel = Channel{Tuple{String, Int}}(max_concurrent_tasks)
	failed_jobs = 0
	running_tasks = 0
	finished_tasks = 0

	if show_progress_bar
		pb = Progress(nrow(rows))
		out_stream = devnull
	else
		pb = nothing
		out_stream = stdout
	end

	for row in eachrow(rows)
		show_progress_bar && next!(pb; showvalues = [("Case #", row.case_number), ("date: ", row.auction_date), ("# active tasks", running_tasks), ("# failed", failed_jobs), ("# finished", finished_tasks)])
        
		task = Task() do 
			let row = row
                args = [row.case_number, row.borough, row.auction_date]
                p = run(pipeline(`node scrapers/notice_of_sale.js $args`, out_stream, stderr), wait=true)				
                put!(channel, (row.case_number, p.exitcode))
			end
		end
		while running_tasks >= max_concurrent_tasks
			# Wait until a previous task finishes
			# ("if" instead of "while" should also be fine)
			finished_case_number, exitcode = take!(channel)
			exitcode == 0 || (failed_jobs += 1; @warn "Processing case #$finished_case_number failed!")
			running_tasks -= 1
			finished_tasks += 1
		end
		
		push!(tasks, task)
		schedule(task)
		running_tasks += 1
	end

	wait.(tasks)
	running_tasks = 0
	finished_tasks = length(tasks)  # i.e. nrow(rows)

	while !isempty(channel)
		finished_case_number, exitcode = take!(channel)
		exitcode == 0 || (failed_jobs += 1; @warn "Processing case #$finished_case_number failed!")
	end
	println("\nNumber of failed jobs: $failed_jobs")

	show_progress_bar && finish!(pb)
end

# Main function
get_filings()