param (
    [Parameter(Mandatory=$true)][string]$FilePath
)

# Convertir ruta relativa a absoluta sin Resolve-Path (que falla si el archivo no existe aún)
if (-not [System.IO.Path]::IsPathRooted($FilePath)) {
    $FilePath = Join-Path (Get-Location).Path $FilePath
}
$FilePath = [System.IO.Path]::GetFullPath($FilePath)

# Verificar que el archivo existe
if (-not (Test-Path $FilePath)) {
    Write-Error "No se encontró el archivo: $FilePath"
    exit 1
}

Write-Host "Preparando reporte en:"

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $workbook = $excel.Workbooks.Open($FilePath)
    $worksheet = $workbook.Worksheets.Item(1)

    # El reporte de Nutrición (SSRS) normalmente tiene el encabezado de la tabla en la fila 5 o 6.
    # Pero las columnas A a F están a lo largo de toda la hoja.
    $rangeToDelete = $worksheet.Range("A:F")
    $rangeToDelete.Delete()
    
    # Encontramos la fila de cabecera. Es la fila que tiene la palabra "Documento" o "Nombre" etc
    # en la nueva columna A. Para simplificar, buscamos la primera celda en la col A (desde la fila 3) 
    # que tenga un color de fondo (usualmente gris/azul en Cuéntame) o texto fuerte.
    $headerRow = 5
    for ($i = 1; $i -le 15; $i++) {
        $val = $worksheet.Cells.Item($i, 1).Text
        if ($val -match "^[A-Za-z0-9]") {
            # Usually the first real column header after deleting A-F could be "Tipo Documento" or something.
            # Let's just assume row 5 for Cuéntame SSRS, but we can search for a row with many non-empty cells
            $count = 0
            for ($j = 1; $j -le 5; $j++) {
                if (-not [string]::IsNullOrWhiteSpace($worksheet.Cells.Item($i, $j).Text)) { $count++ }
            }
            if ($count -ge 3) {
                $headerRow = $i
                break
            }
        }
    }
    
    Write-Host "Fila de encabezado detectada: $headerRow"

    $usedRange = $worksheet.UsedRange
    $sortRange = $worksheet.Range("A$headerRow", $usedRange.SpecialCells(11))
    $key1 = $worksheet.Range("A$headerRow")
    
    # Ordenar A-Z
    $sortRange.Sort($key1, 1, [Type]::Missing, [Type]::Missing, 1, [Type]::Missing, 1, 1)

    # Agregar AutoFiltro
    $worksheet.Range("A$headerRow").AutoFilter() | Out-Null

    $workbook.Save()
    Write-Host "Reporte preparado exitosamente."
} catch {
    Write-Error "Error al preparar el archivo Excel: $_"
} finally {
    if ($workbook) { $workbook.Close($false) }
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
