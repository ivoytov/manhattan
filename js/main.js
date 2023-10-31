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
          // Use destructuring to get other properties if needed
          const { "SALE DATE": saleDate, ...rest } = obj;

          // Convert string to Date, set to midnight (otherwise date filter doesn't work)
          const saleDateObj = new Date(saleDate);
          saleDateObj.setHours(0,0,0,0)

          // Add other properties back if needed
          return { "SALE DATE": saleDateObj, ...rest };
        });


        resolve(results.data);
      },
      error: error => {
        reject(error.message);
      }
    });
  });
}

// URLs of the CSV files you want to load
const csvUrls = [
  'manhattan.csv',
  'bronx.csv',
  'brooklyn.csv',
  'queens.csv',
  'statenisland.csv'
];

// Array to store promises for each CSV file
const csvPromises = csvUrls.map(url => loadCSV(`transactions/${url}`));

const defaultColDef = {
  flex: 1,
  minWidth: 150,
  filter: 'agTextColumnFilter',
  menuTabs: ['filterMenuTab'],
  autoHeaderHeight: true,
  wrapHeaderText: true
}

// Use Promise.all to wait for all promises to resolve
Promise.all(csvPromises)
  .then(resultsArray => {
    // Combine the results from all CSV files
    const combinedData = resultsArray.reduce((acc, data) => acc.concat(data), []);

    const columnDefs = Object.keys(combinedData[0]).map(key => ({ headerName: key, field: key }))
    
    columnDefs[0].filter = 'agDateColumnFilter'

    const formattedCurrency = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

    columnDefs[columnDefs.length - 1].valueFormatter = (params) => formattedCurrency.format(params.value)
    columnDefs[columnDefs.length - 1].filter = 'agNumberColumnFilter'

    // Initialize AG Grid
    const gridOptions = {
      columnDefs: columnDefs,
      rowData: combinedData,
      defaultColDef: defaultColDef,
    };

    // Create AG Grid
    const gridDiv = document.querySelector('#myGrid');
    new agGrid.Grid(gridDiv, gridOptions);
  })
  .catch(error => {
    console.error('Error loading CSV files:', error);
  });