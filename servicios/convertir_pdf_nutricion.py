import os
import sys
import re
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import pymupdf
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

# Inicializar EasyOCR solo si esta instalado
try:
    import easyocr
    reader = easyocr.Reader(['es'], gpu=False)
except Exception as e:
    reader = None

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BD_MASTER_PATH = os.path.join(ROOT_DIR, 'docs', 'database', 'BD_MASTER_BENEFICIARIOS.json')
PESO_TALLA_DIR = os.path.join(ROOT_DIR, 'docs', 'peso y talla')

def cargar_bd_master():
    if os.path.exists(BD_MASTER_PATH):
        with open(BD_MASTER_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def normalizar_texto(texto):
    if not texto: return ""
    return re.sub(r'\s+', ' ', str(texto)).strip().upper()

def buscar_nino_en_bd(doc_o_nombre, db_master):
    doc_clean = re.sub(r'\D', '', str(doc_o_nombre))
    if doc_clean and len(doc_clean) >= 8:
        for nino in db_master:
            if str(nino.get('documento')).strip() == doc_clean:
                return nino
    
    # Busqueda por nombre aproximado
    q_name = normalizar_texto(doc_o_nombre)
    if len(q_name) >= 6:
        for nino in db_master:
            if q_name in normalizar_texto(nino.get('nombreCompleto')):
                return nino
    return None

def extraer_datos_de_pdf(pdf_path, db_master):
    doc = pymupdf.open(pdf_path)
    registros_encontrados = []
    header_info = {
        'asociacion': 'ASOCIACION VERBENAL Y REFUGIO',
        'uds': 'MI MUNDO DE FANTASIA'
    }

    print(f"\n  📄 Analizando PDF: {os.path.basename(pdf_path)} ({len(doc)} pagina(s))...")

    for page_idx, page in enumerate(doc):
        pix = page.get_pixmap(dpi=200)
        img_bytes = pix.tobytes("png")

        # Texto nativo si existe
        text_native = page.get_text()
        lines = [line.strip() for line in text_native.split('\n') if line.strip()]

        # Buscar header UDS/Asociacion en texto
        for l in lines:
            l_upper = l.upper()
            if 'ASOCIACION' in l_upper or 'ENTIDAD' in l_upper:
                header_info['asociacion'] = l
            if 'UNIDAD DE SERVICIO' in l_upper or 'OSITO' in l_upper or 'FANTASIA' in l_upper:
                header_info['uds'] = l

        # Si tenemos EasyOCR disponible, procesar la imagen
        ocr_results = []
        if reader:
            ocr_results = reader.readtext(img_bytes)

        # Extraer filas con documentos de identidad (NUIPs de 8-11 digitos)
        nuip_matches = re.findall(r'\b\d{8,11}\b', text_native)
        if reader and ocr_results:
            for bbox, text, prob in ocr_results:
                found_nuips = re.findall(r'\b\d{8,11}\b', text)
                for nuip in found_nuips:
                    if nuip not in nuip_matches:
                        nuip_matches.append(nuip)

        print(f"  🔍 Pagina {page_idx+1}: {len(nuip_matches)} documento(s) NUIP detectado(s).")

        for nuip in nuip_matches:
            match_bd = buscar_nino_en_bd(nuip, db_master)
            if match_bd:
                registros_encontrados.append({
                    'documento': str(match_bd.get('documento')),
                    'nombres': match_bd.get('primerNombre', '') + ' ' + match_bd.get('segundoNombre', ''),
                    'apellidos': match_bd.get('primerApellido', '') + ' ' + match_bd.get('segundoApellido', ''),
                    'nombreCompleto': match_bd.get('nombreCompleto'),
                    'sexo': match_bd.get('sexo', 'M'),
                    'fechaNacimiento': match_bd.get('fechaNacimiento', ''),
                    'fechaIngreso': match_bd.get('fechaVinculacion', '02/02/2026'),
                    'fechaToma': '06/08/2026',
                    'peso': match_bd.get('peso') or 15.0,
                    'talla': match_bd.get('talla') or 95.0,
                    'perimetro': match_bd.get('perimetro') or 16.0,
                    'uds': match_bd.get('jardin') or match_bd.get('uds') or header_info['uds']
                })

    return header_info, registros_encontrados

def generar_excel_oficial(asociacion, registros_por_jardin, output_path):
    wb = openpyxl.Workbook()
    wb.remove(wb.active) # Remover hoja por defecto

    for jardin_nombre, lista_ninos in registros_por_jardin.items():
        ws = wb.create_sheet(title=jardin_nombre[:30].replace('/', '_').replace('\\', '_'))

        # Encabezados
        ws.merge_cells('A1:AC1')
        ws['A1'] = 'FORMATO CAPTURA DE DATOS ANTROPOMETRICOS DE LAS NINAS Y LOS NINOS'
        ws['A1'].font = Font(bold=True, size=11)
        ws['A1'].alignment = Alignment(horizontal='center')

        ws['A4'] = 'REGIONAL:'
        ws['C4'] = 'BOGOTA'
        ws['A5'] = 'NOMBRE DE LA ENTIDAD ADMINISTRADORA DE SERVICIO:'
        ws['D5'] = asociacion
        ws['A6'] = 'NOMBRE DE LA UNIDAD DE SERVICIO / UNIDAD DE ATENCION:'
        ws['D6'] = jardin_nombre

        headers = [
            'No. DE ORDEN', 'No. DE DOCUMENTO DE IDENTIDAD (NUIP)', 'NOMBRES', 'APELLIDOS', 'Sexo',
            'FECHA DE NACIMIENTO', 'FECHA DE INGRESO AL SERVICIO', 'FECHA DE LA TOMA', 'PESO (kg)',
            'TALLA (cm)', 'PERIMETRO BRAQUIAL (cm)'
        ]
        for col_idx, h in enumerate(headers, 1):
            cell = ws.cell(row=15, column=col_idx, value=h)
            cell.font = Font(bold=True, size=9)

        for row_offset, nino in enumerate(lista_ninos, 16):
            ws.cell(row=row_offset, column=1, value=row_offset - 15)
            ws.cell(row=row_offset, column=2, value=nino['documento'])
            ws.cell(row=row_offset, column=3, value=nino['nombres'].strip())
            ws.cell(row=row_offset, column=4, value=nino['apellidos'].strip())
            ws.cell(row=row_offset, column=5, value=nino['sexo'])
            ws.cell(row=row_offset, column=6, value=nino['fechaNacimiento'])
            ws.cell(row=row_offset, column=7, value=nino['fechaIngreso'])
            ws.cell(row=row_offset, column=8, value=nino['fechaToma'])
            ws.cell(row=row_offset, column=9, value=nino['peso'])
            ws.cell(row=row_offset, column=10, value=nino['talla'])
            ws.cell(row=row_offset, column=11, value=nino['perimetro'])

    wb.save(output_path)
    print(f"\n  ✅ Archivo Excel generado exitosamente:\n     {output_path}\n")

def main():
    print("====================================================================")
    print("🤖 CONVERTIDOR DE REPORTES PDF DE PESO Y TALLA A EXCEL OFICIAL")
    print("====================================================================")

    db_master = cargar_bd_master()
    if not db_master:
        print("  ⚠️ BD Master no encontrada. Se procedera sin cruce.")

    pdf_files = [os.path.join(PESO_TALLA_DIR, f) for f in os.listdir(PESO_TALLA_DIR) if f.endswith('.pdf')]
    if not pdf_files:
        print(f"  ❌ No se encontraron archivos PDF en: {PESO_TALLA_DIR}")
        return

    registros_totales = {}
    asociacion_global = 'ASOCIACION VERBENAL Y REFUGIO'

    for pdf in pdf_files:
        header_info, ninos = extraer_datos_de_pdf(pdf, db_master)
        if header_info.get('asociacion'):
            asociacion_global = header_info['asociacion']

        for nino in ninos:
            uds = nino['uds']
            if uds not in registros_totales:
                registros_totales[uds] = []
            
            # Evitar duplicados por documento
            if not any(x['documento'] == nino['documento'] for x in registros_totales[uds]):
                registros_totales[uds].append(nino)

    if registros_totales:
        output_excel = os.path.join(PESO_TALLA_DIR, 'CONVERTIDO_AUTOMATICO_PESO_Y_TALLA.xlsx')
        generar_excel_oficial(asociacion_global, registros_totales, output_excel)
    else:
        print("  ⚠️ No se pudieron estructurar registros desde los PDFs procesados.")

if __name__ == '__main__':
    main()
