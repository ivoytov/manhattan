using HTTP, HTMLForge, Downloads, AbstractTrees, Base.Filesystem

headers = Dict(
        "User-Agent" =>  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15"
)
host = "https://www.nycourts.gov" 
url = "$host/legacyPDFs/courts/2jd/kings/civil/foreclosures/foreclosure%20scans/"
response = HTTP.get(url, headers=headers)
html_content = String(response.body)
parsed_html = parsehtml(html_content)
links = []
for link in PreOrderDFS(parsed_html.root) 
    if link isa HTMLElement && tag(link) == :a && haskey(attrs(link), "href") && endswith(attrs(link)["href"], ".pdf")
        push!(links, host * attrs(link)["href"])
    end
end
function extract_text_from_pdf(pdf_path::String, txt_path::String)
    run(`tesseract $pdf_path $txt_path pdf`)
    return read(txt_path * ".txt", String)
end

for (i, url) in enumerate(links)
    txt_path = "file_$i"

    pdf_path = Downloads.download(url, headers=headers)

    extracted_text = extract_text_from_pdf(pdf_path, txt_path)

    println(extracted_text)
    rm(txt_path * ".txt")
end
