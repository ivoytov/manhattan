using CSV, DataFrames, ProgressMeter, Base.Threads, Dates, Random, DotEnv

DotEnv.load!()
# Get filings. If WSS is set then we are running locally, otherwise on git.
function main()
	download_pdf_links()

    rows = get_data()
	# filter!(row -> row.auction_date < Date(2025,1,31), rows)
	is_local = haskey(ENV, "WSS")
	# Filter rows where :missing_filings contains FilingType[:NOTICE_OF_SALE]
	urgent_rows = rows[(in.(FilingType[:NOTICE_OF_SALE], rows.missing_filings)) .& (rows.auction_date .>= today()), :]
	urgent_row_count = nrow(urgent_rows)

	# Shuffle the remaining rows and select N at random
	sampled_rows = rows[.!in.(FilingType[:NOTICE_OF_SALE], rows.missing_filings), :]
	sampled_row_count = nrow(sampled_rows)
	println("Repo state: $urgent_row_count urgent cases, $sampled_row_count sampled rows outstanding")

	if !is_local
		max_docs = 100
		urgent_rows = urgent_rows[1:min(nrow(urgent_rows), max_docs), :]
		n = min(max_docs - nrow(urgent_rows), nrow(sampled_rows))
		sampled_rows = sampled_rows[shuffle(1:nrow(sampled_rows))[1:n], :]
	end

	# Combine the filtered rows with the randomly selected rows
	rows = vcat(urgent_rows, sampled_rows)
	println("Task list: $(nrow(urgent_rows)) urgent cases, $(nrow(sampled_rows)) sampled rows, $(nrow(rows)) total tasks")
    process_data(rows, is_local ? 2 : 4, is_local)
end

# Define the FilingType as a constant dictionary
const FilingType = Dict(
    :NOTICE_OF_SALE =>  "noticeofsale",
    :SURPLUS_MONEY_FORM => "surplusmoney"
)

get_filename(case_number) = replace(case_number, "/" => "-") * ".pdf"


function download_pdf_links()
	download_path = "foreclosures/download.csv"
    rows = CSV.read(download_path, DataFrame)
	filter!(:filename => filename -> !isfile(joinpath("saledocs", filename)), rows)
	CSV.write(download_path, rows)

	for row in eachrow(rows)
		path = joinpath("saledocs", row.filename)
		run(pipeline(ignorestatus(`node scrapers/download_pdf.js $(row.url) $path`), stdout, stderr), wait=true)				
	end
end

# Function to find missing filings
function missing_filings(case_number, auction_date)
	if auction_date < today() - Day(30)
		return []
	end

    filename = get_filename(case_number)

    res = []
    for (key, dir) in FilingType
        pdfPath = joinpath("saledocs", dir, filename)
        if !isfile(pdfPath)
            push!(res, dir)
        end
    end
    

    # For auctions in the last 5 days, don't look for a surplus money form
    earliestDayForMoneyForm = today() - Day(1)

    # For auctions more than 35 days in the future, don't look for a notice of sale
    latestDayForNoticeOfSale = today() + Day(35)

    if !isnothing(auction_date) && auction_date > earliestDayForMoneyForm
        # If auction date in the future, only get the notice of sale, otherwise get the surplus money form too
        res = filter(filing -> filing != FilingType[:SURPLUS_MONEY_FORM], res)
    end

    if !isnothing(auction_date) && auction_date > latestDayForNoticeOfSale
        # If auction date too far in the future, don't look for a notice of sale
        res = filter(filing -> filing != FilingType[:NOTICE_OF_SALE], res)
    end

    return res
end

function get_data()
    
    cases_path = "foreclosures/cases.csv"
    rows = CSV.read(cases_path, DataFrame)
    
    sort!(rows, order(:auction_date), rev=true)

    transform!(rows, [:case_number, :auction_date] => ByRow(missing_filings) => :missing_filings)
    filter!(row -> !isempty(row.missing_filings), rows)

    # display(rows[:, [:case_number, :borough, :auction_date, :missing_filings]])
	println(nrow(rows), " cases have missing filings")
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

	total = nrow(rows)
	for (idx, row) in enumerate(eachrow(rows))
		show_progress_bar && next!(pb; showvalues = [("Case #", row.case_number), ("date: ", row.auction_date), ("# active tasks", running_tasks), ("# failed", failed_jobs), ("# finished", finished_tasks)])
        !show_progress_bar && println("$idx/$total === $(row.case_number) $(row.borough) ===")

		task = Task() do 
			let row = row
                args = [row.case_number, row.borough, row.auction_date, row.missing_filings...]
                p = run(pipeline(ignorestatus(`node scrapers/notice_of_sale.js $args`), out_stream, stderr), wait=true)
                put!(channel, (row.case_number, p.exitcode))
			end
		end
		while running_tasks >= max_concurrent_tasks
			# Wait until a previous task finishes
			# ("if" instead of "while" should also be fine)
			finished_case_number, exitcode = take!(channel)
			if exitcode != 0
				failed_jobs += 1
				@warn "Processing case #$finished_case_number failed!"
			end
			
			running_tasks -= 1
			finished_tasks += 1
		end
		
		push!(tasks, task)
		schedule(task)
		running_tasks += 1
	end

	# Wait on tasks and catch exceptions
	for task in tasks
		try
			wait(task)
		catch e
			if isa(e, TaskFailedException)
				println("Task failed with exception: ", e)
			else
				rethrow(e)  # Re-throw if it's not a TaskFailedException
			end
		end
	end
	running_tasks = 0
	finished_tasks = length(tasks)  # i.e. nrow(rows)

	while !isempty(channel)
		finished_case_number, exitcode = take!(channel)
		if exitcode != 0
			failed_jobs += 1
			@warn "Processing case #$finished_case_number failed!"
		end	end
	println("\nNumber of failed jobs: $failed_jobs")

	show_progress_bar && finish!(pb)
end

# Main function
main()
