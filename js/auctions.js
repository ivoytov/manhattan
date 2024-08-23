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
                    const dateKey = "date"

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
        field: "borough",
        filter: 'agSetColumnFilter',
    },
    {
        headerName: "Address",
        field: "address",
        cellRenderer: 'agGroupCellRenderer' 
    },
    {
        headerName: "Case #",
        field: "case_number",
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
            let repeats = getTransactions(params.data);


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
    // Listen for AG Grid filter changes
    onFilterChanged: function () {
        // Get all displayed rows
        let visibleRows = [];
        gridApi.forEachNodeAfterFilterAndSort(function (node) {
            visibleRows.push(node.data);
        });

        // Show or hide markers based on visible rows
        for (let key in markers) {
            markers[key].forEach(l => l.removeFrom(map)); // Remove all markers from map initially
        }
        visibleRows.forEach(function (row) {
            let key = `${row.block}-${row.borough}`;
            if (markers[key]) {
                markers[key].forEach(l => l.addTo(map)); // Add only visible row markers to map
            }
        });
    }
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

        // get the address from transaction records
        for (const auction of auctions) {
            const transactions = getTransactions(auction)
            if (transactions.length > 0) {
                auction.address =  transactions[transactions.length - 1]["ADDRESS"]
            }

        }
        

        // load the full table
        gridApi.setGridOption('rowData', auctions)
        gridApi.sizeColumnsToFit()
    })
    // .catch(error => {
    //     console.error('Error loading CSV files:', error);
    // });


function getTransactions(data) {
    let repeats = combinedData.filter(({ BOROUGH, BLOCK, LOT }) => BOROUGH == data.borough && BLOCK == data.block && LOT == data.lot);
    repeats.sort((a, b) => a["SALE DATE"] - b["SALE DATE"]);
    return repeats;
}

let map = L.map('map').setView([40.7143, -74.0060], 13);

// Style URL format in XYZ PNG format; see our documentation for more options
L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
}).addTo(map);

// Function to calculate the centroid of a GeoJSON geometry
function getCentroid(geometry) {
    let latlng = [];
    
    switch (geometry.type) {
        case 'Polygon':
            latlng = L.polygon(geometry.coordinates).getBounds().getCenter();
            break;
        case 'MultiPolygon':
            latlng = L.polygon(geometry.coordinates[0]).getBounds().getCenter();
            break;
        case 'Point':
            latlng = L.latLng(geometry.coordinates[1], geometry.coordinates[0]);
            break;
        default:
            console.error('Unsupported geometry type:', geometry.type);
            break;
    }
    return latlng;
}

const borough_dict = {
        "1": "Manhattan",
        "2": "Bronx",
        "3": "Brooklyn",
        "4": "Queens",
        "5": "Staten Island",
}

let markers = {};

// Load the GeoJSON file
fetch('transactions/auctions.geojson')
    .then(response => response.json())
    .then(geojsonFeature => {
        L.geoJSON(geojsonFeature, {
            onEachFeature: function (feature, layer) {
                let block = feature.properties.BLOCK;
                let borough = borough_dict[feature.properties.BORO];

                // Store the marker in the markers object
                let key = `${block}-${borough}`;
                if (!markers[key]) {
                    markers[key] = []
                }
                markers[key].push(layer);

                layer.on('click', function () {
                    
                    // Highlight the row in AG Grid
                    gridApi.forEachNode(function (node) {
                        if (node.data.block === block && node.data.borough === borough) {
                            node.setSelected(true, true); // Select the row

                            // Ensure the selected row is visible by scrolling to it
                            gridApi.ensureIndexVisible(node.rowIndex, 'middle');
                        }
                    });
                });
                
            }

            
        }).addTo(map);
    })
    .catch(error => console.error('Error loading GeoJSON:', error));

