using DataFrames, Dates, CSV, GLM

df = CSV.File("transactions/nyc_2018-2022.csv") |> DataFrame
boroughs = ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]
rolling_sales = vcat([CSV.read("transactions/$borough.csv", DataFrame) for borough in boroughs]...)
rolling_sales = rolling_sales[rolling_sales[!, "SALE DATE"] .> Date(2022,12,31), :]
df = vcat(df, rolling_sales)

borough_dict = Dict(1 => "Manhattan", 2 => "Bronx", 3 => "Brooklyn", 4 => "Queens", 5 => "Staten Island")
df[!, "BOROUGH"] = map(borough_id -> borough_dict[borough_id], df[!, "BOROUGH"])

df = df[df[!, "SALE PRICE"] .> 100000, :]

SFH_CATEGORIES = r"01"
COOP_CATEGORIES = r"09|[^-]10|17"
CONDO_CATEGORIES = r"12|13"

sfh = occursin.(SFH_CATEGORIES, df[!, "BUILDING CLASS CATEGORY"])
coops = occursin.(COOP_CATEGORIES, df[!, "BUILDING CLASS CATEGORY"])
condos = occursin.(CONDO_CATEGORIES, df[!, "BUILDING CLASS CATEGORY"])

df[!, :house_class] .= "Condo"
df[coops, :house_class] .= "Coop"
df[sfh, :house_class] .= "SFH"

df = df[coops .| condos .| sfh, :]

# Create uid for condos and sfh
condo_sfh_filter = condos .| sfh
df[!, :uid] .= string.(df[!, :BLOCK]) .* '_' .* string.(df[!, :LOT])

# Create uid for coops
coops_filter = df[!, :house_class] .== "Coop"
apartment = split.(df[coops_filter, "ADDRESS"],", "; limit=2) .|> x -> get(x,2,"") .|> lowercase .|> x -> replace(x, r"(?:UNIT)?(?:APT)?[^A-Z0-9\n]" => "")
missing_apartment = map(x-> x=="",apartment)

df[coops_filter, :uid] .= string.(df[coops_filter, :BLOCK]) .* '_' .* apartment
rows_to_remove = findall(coops_filter)[missing_apartment]
df = df[setdiff(1:end,rows_to_remove), :]

df = rename(df, "BOROUGH" => :borough, "SALE DATE" => :sale_date, "SALE PRICE" => :sale_price)

cols = [:borough, :sale_date, :uid, :sale_price]
archive = CSV.read("transactions/nyc_real_estate_211231.csv", DataFrame)[!, cols]
archive = dropmissing(archive, [:uid])
archive = archive[archive.sale_date .< Date(2018,1,1), :]


df = vcat(df[:, cols], archive[:, cols])

# Convert 'sale_date' to PeriodIndex with frequency
df[!, :period] = Dates.lastdayofmonth.(df.sale_date)

# Drop duplicates based on 'period' and 'uid', keeping the last one
df = dropmissing(df, [:period, :uid])

df =  df[df.sale_price .> 1.0e5, :] |> df -> sort(df, [:uid, :sale_date])
grouped = groupby(df, ["borough", "uid"])
grouped = grouped[combine(grouped, nrow).nrow .> 1]

rng = sort(unique(df.period))

n = sum(combine(grouped, gp -> nrow(gp) - 1).x1)
p = size(rng, 1)  # degrees of freedom aka num of periods
X = zeros(Int64, (n, p))   # first column of X will become Y vector
Y = zeros(Float64, (n, 1))
Δ = zeros(Int64, (n , 1))
row = 1

for group in grouped
    for i in 1:size(group,1)-1
        buy = group[i, :]
        sell = group[i+1, :]
        q₁ = findfirst(rng .== buy.period)
        q₂ = findfirst(rng .== sell.period)
        X[row, q₁] = -1
        X[row, q₂] = 1
        Y[row] = log(sell.sale_price) - log(buy.sale_price) 
        Δ[row] = q₂ - q₁
        global row += 1
    end
end

x = DataFrame(X, Symbol.(rng))
x[!, :Y] = Y[:]
formula = term(:Y) ~ term(0) + sum(term.(Symbol.(rng)))

lm_model = lm(formula, x)
e = residuals(lm_model)

R = DataFrame(hcat(Δ, e), [:Δ, :e])
w_model = lm(@formula(e^2 ~ 0 + Δ), R)

w = 1 ./ sqrt.(predict(w_model))

w[isinf.(w)] .= 1
wrs_model = lm(formula, x, wts=w)

idx = DataFrame(period = rng, home_price_index = 100 * ℯ .^ coef(wrs_model))
idx[:, Not(:period)] = round.(idx[:, Not(:period)], digits=2)
CSV.write("home_price_index.csv", idx)