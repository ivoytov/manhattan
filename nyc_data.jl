# %%
using XLSX, DataFrames, CSV
prefix_url = "https://www.nyc.gov/assets/finance/downloads/pdf/rolling_sales/rollingsales_.xlsx"
borough = "manhattan"
filename = download(manhattan_url)
new_df = XLSX.openxlsx(filename) do xf
    sheet_name = XLSX.sheetnames(xf)[1]
    DataFrame(XLSX.gettable(xf[sheet_name]; first_row=5, infer_eltypes=true))
end

df = CSV.File("$borough.csv") |> DataFrame

# Get list of existing sale dates
existing_dates = Set(df[!, "SALE DATE"])

# Filter new_df to rows with new dates
new_rows = filter(row -> row["SALE DATE"] ∉ existing_dates, eachrow(new_df))

# If there are new rows, append them to the CSV
if length(new_rows) > 0
    CSV.write("$borough.csv", new_rows; append=true) 
end