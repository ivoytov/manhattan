const bronxUrl = "transactions/bronx.csv"

Papa.parse(bronxUrl, {
  download: true,
  complete: function (results) {
    console.log(results);
  }
});

// Function to load CSV file using PapaParse
function loadCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: results => {
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

// Use Promise.all to wait for all promises to resolve
Promise.all(csvPromises)
  .then(resultsArray => {
    // Combine the results from all CSV files
    const combinedData = resultsArray.reduce((acc, data) => acc.concat(data), []);

    // Initialize AG Grid
    const gridOptions = {
      columnDefs: Object.keys(combinedData[0]).map(key => ({ headerName: key, field: key })),
      rowData: combinedData
    };

    // Create AG Grid
    const gridDiv = document.querySelector('#myGrid');
    new agGrid.Grid(gridDiv, gridOptions);
  })
  .catch(error => {
    console.error('Error loading CSV files:', error);
  });