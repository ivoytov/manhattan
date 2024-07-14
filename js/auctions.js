// Function to load CSV file using PapaParse
function loadCSV(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: results => {
                // Convert "SALE DATE" property to JavaScript Date objects
                results.data = results.data.map(obj => {
                    const dateKey = "SALE DATE" in obj ? "SALE DATE" : "period"

                    // Use destructuring to get other properties if needed
                    const { [dateKey]: saleDate, ...rest } = obj;

                    // Convert string to Date, set to midnight (otherwise date filter doesn't work)
                    const saleDateObj = new Date(saleDate);
                    saleDateObj.setHours(24, 0, 0, 0)

                    // Add other properties back if needed
                    return { [dateKey]: saleDateObj, ...rest };
                });


                resolve(results.data);
            },
            error: error => {
                reject(error.message);
            }
        });
    });
}
let combinedData = []

// Function to load CSV file using PapaParse
function loadTransactionDataCSV(url) {
    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            header: true,
            download: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            worker: false,
            step: row => {
                const dateKey = "SALE DATE"

                // Use destructuring to get other properties if needed
                const { [dateKey]: saleDate, ...rest } = row.data;

                // Convert string to Date, set to midnight (otherwise date filter doesn't work)
                const saleDateObj = new Date(saleDate);
                saleDateObj.setHours(24, 0, 0, 0)

                // Add other properties back if needed
                const cleanRow = { [dateKey]: saleDateObj, ...rest };
                
                combinedData.push(cleanRow)
            },
            complete: () => {
                console.log("All done")
                resolve(true)
            },
            error: error => {
                reject(error.message);
            }
        });
    });
}


// Filter model
const defaultFilter = {
    "BUILDING CLASS CATEGORY": {
        filterType: 'text',
        type: 'condo',
    },
    "SALE PRICE": {
        filterType: 'number',
        type: 'greaterThan',
        filter: 100000
    }
}


// date,case_number,case_name,block,lot

// grid columns
const columnDefs = [
    {
        headerName: "Case #",
        field: "case_number",
        cellRenderer: 'agGroupCellRenderer' 
    },
    {
        headerName: "Auction Date",
        field: "date",
        suppressSizeToFit: true,
        minWidth: 120,
        filter: 'agDateColumnFilter',
        sort: "desc",
        sortIndex: 0
    },
 
    {
        headerName: "Block", field: "block",
        filter: 'agNumberColumnFilter',
    },
    {
        headerName: "Lot", field: "lot",
        filter: 'agNumberColumnFilter',
    },
    
]

const formattedCurrency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});

const coopsFilter = (row) =>
    row['BUILDING CLASS CATEGORY'].startsWith('09')
    || row['BUILDING CLASS CATEGORY'].startsWith('10')
    || row['BUILDING CLASS CATEGORY'].startsWith('17')

const formattedPercent = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
})


const defaultColDef = {
    flex: 1,
    minWidth: 100,
    filter: 'agTextColumnFilter',
    menuTabs: ['filterMenuTab'],
    autoHeaderHeight: true,
    wrapHeaderText: true,
    sortable: true,
    resizable: true
}

// Initialize AG Grid
const gridOptions = {
    columnDefs: columnDefs,
    defaultColDef: defaultColDef,
    masterDetail: true,
    detailRowAutoHeight: true,

    detailCellRendererParams: {
        detailGridOptions: {
            columnDefs: [
                {
                    headerName: "Address", field: "ADDRESS", 
                    minWidth: 200,
                  },
                  {
                    headerName: "Neighborhood", field: "NEIGHBORHOOD",
                    filter: 'agSetColumnFilter'
                  },
                  {
                    headerName: "Category", field: "BUILDING CLASS CATEGORY",
                  },
                  {
                    headerName: "Apt #", field: "APARTMENT NUMBER"
                  },
                  {
                    headerName: "Total Units", field: "TOTAL UNITS",
                    filter: 'agNumberColumnFilter',
                  },
                {
                    field: 'SALE DATE',
                    headerName: 'Sale Date',
                    filter: 'agDateColumnFilter',
                    sort: "asc",
                    sortIndex: 0,
                    sortable: true
                },
                {
                    headerName: 'Sale Price',
                    field: "SALE PRICE",
                    valueFormatter: (params) => formattedCurrency.format(params.value),
                },
                {
                    headerName: 'Change, $',
                    field: "priceChange",
                    filter: 'agNumberColumnFilter',
                    valueFormatter: (params) => params.value != null ? formattedCurrency.format(params.value) : "N/A",
                },
                {
                    headerName: 'Change, %',
                    field: "priceChangePct",
                    filter: 'agNumberColumnFilter',
                    valueFormatter: (params) => params.value != null ? formattedPercent.format(params.value) : "N/A",
                },

            ],
            defaultColDef: {
                flex: 1,
                sortable: true,
                filter: 'agNumberColumnFilter',
            },
        },
        getDetailRowData: (params) => {
            // find all transactions for this address
            let repeats = 
                combinedData.filter(({ BOROUGH, BLOCK, LOT }) => BOROUGH == "Manhattan" && BLOCK == params.data.block && LOT == params.data.lot)
            repeats.sort((a, b) => a["SALE DATE"] - b["SALE DATE"])

            // remove erroneous transactions
            repeats = repeats.filter((transaction) => transaction["SALE PRICE"] >= 100000)

            // add % price change
            repeats = repeats.map((transaction, index, arr) => {
                // For the first row, priceChange is null
                if (index === 0) {
                    return { ...transaction, priceChange: null };
                }

                // For subsequent rows, priceChange is the difference in price over the immediately preceding sale
                const priceChange = transaction["SALE PRICE"] - arr[index - 1]["SALE PRICE"];
                const priceChangePct = transaction["SALE PRICE"] / arr[index - 1]["SALE PRICE"] - 1;
                return { ...transaction, priceChange, priceChangePct };
            });

            params.successCallback(repeats);
        },
    },
};

// Create AG Grid
const gridDiv = document.querySelector('#myGrid');
const gridApi = agGrid.createGrid(gridDiv, gridOptions)

const csvPromises = [
    loadTransactionDataCSV('transactions/auction_sales.csv'),
    loadCSV('transactions/foreclosure_auctions.csv')
]

// Use Promise.all to wait for all promises to resolve
Promise.all(csvPromises).then(([_, auctions]) => {

        // load the full table
        gridApi.setGridOption('rowData', auctions)
        gridApi.sizeColumnsToFit()
    })
    .catch(error => {
        console.error('Error loading CSV files:', error);
    });


