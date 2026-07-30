const fs = require('fs');
let code = fs.readFileSync('automatizaciones/llenar-asistencia.js', 'utf8');

const patch = `
  // Fix contract numbers
  const overrideContratos = {
    'VERBENAL Y REFUGIO': '11027492024',
    'BRISAS DE BUENAVISTA': '11026892024'
  };
  for (let asc of asociaciones) {
      if (overrideContratos[asc.nombreCorto]) {
          asc.numeroContrato = overrideContratos[asc.nombreCorto];
      }
  }
`;

code = code.replace(/let asociaciones = Object\.values\(porAsociacion\)\.filter\(a => a\.numeroContrato\);/, "let asociaciones = Object.values(porAsociacion).filter(a => a.numeroContrato);" + patch);

fs.writeFileSync('automatizaciones/llenar-asistencia.js', code);
