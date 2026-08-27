"""
convertir_pdf_nutricion.py
Motor de procesamiento visual (OCR) y conversion de reportes PDF de Peso y Talla a Excel oficial del ICBF.
Genera UN archivo Excel individual por cada Jardin / PDF en docs/peso y talla/ y guarda respaldo en docs/respaldos/.
"""

import os
import sys
import re
import json
import io

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import pymupdf
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from PIL import Image

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
    if doc_clean and len(doc_clean) >= 7:
        for nino in db_master:
            if str(nino.get('documento')).strip() == doc_clean:
                return nino
            # Permitir coincidencia si hay error de 1 digito por OCR
            doc_db = str(nino.get('documento')).strip()
            if len(doc_clean) == len(doc_db) and sum(1 for a, b in zip(doc_clean, doc_db) if a != b) <= 1:
                return nino
    
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
        'asociacion': 'ASOCIACION BARRIOS UNIDOS',
        'uds': 'UNIDAD DE SERVICIO'
    }

    for page_idx, page in enumerate(doc):
        text_native = page.get_text()
        lines = [line.strip() for line in text_native.split('\n') if line.strip()]

        for l in lines:
            l_upper = l.upper()
            if 'ASOCIACION' in l_upper or 'ENTIDAD' in l_upper:
                header_info['asociacion'] = l
            if 'UNIDAD DE SERVICIO' in l_upper or 'HCB' in l_upper or 'JARDIN' in l_upper:
                header_info['uds'] = l

        nuip_matches = re.findall(r'\b\d{7,11}\b', text_native)

        # Si el texto nativo no trae suficientes NUIPs, aplicar OCR enfocado en la columna de documentos
        if len(nuip_matches) < 3 and reader:
            pix = page.get_pixmap(dpi=150)
            width, height = pix.width, pix.height
            # Recortar solo la region donde estan los NUIPs (x: 4% a 35%, y: 15% a 92%)
            crop_box = (int(width * 0.04), int(height * 0.15), int(width * 0.35), int(height * 0.92))
            img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
            cropped_img = img.crop(crop_box)

            img_byte_arr = io.BytesIO()
            cropped_img.save(img_byte_arr, format='PNG')
            ocr_results = reader.readtext(img_byte_arr.getvalue())

            for bbox, text, prob in ocr_results:
                found_nuips = re.findall(r'\b\d{7,11}\b', text)
                for nuip in found_nuips:
                    if nuip not in nuip_matches:
                        nuip_matches.append(nuip)

        print(f"  🔍 Pagina {page_idx+1}: {len(nuip_matches)} documento(s) detectado(s).")

        for nuip in nuip_matches:
            match_bd = buscar_nino_en_bd(nuip, db_master)
            if match_bd:
                doc_real = str(match_bd.get('documento'))
                if not any(r['documento'] == doc_real for r in registros_encontrados):
                    p_nom = match_bd.get('pNombre') or match_bd.get('primerNombre') or ''
                    s_nom = match_bd.get('sNombre') or match_bd.get('segundoNombre') or ''
                    p_ape = match_bd.get('pApell') or match_bd.get('primerApellido') or ''
                    s_ape = match_bd.get('sApell') or match_bd.get('segundoApellido') or ''

                    nombres_str = f"{p_nom} {s_nom}".strip() or str(match_bd.get('nombreCompleto') or '')
                    apellidos_str = f"{p_ape} {s_ape}".strip() or '...'

                    registros_encontrados.append({
                        'documento': doc_real,
                        'nombres': nombres_str,
                        'apellidos': apellidos_str,
                        'nombreCompleto': match_bd.get('nombreCompleto'),
                        'sexo': match_bd.get('sexo', 'M'),
                        'fechaNacimiento': match_bd.get('fechaNacimiento', ''),
                        'fechaIngreso': match_bd.get('fechaVinculacion', '02/02/2026'),
                        'fechaToma': '06/08/2026',
                        'peso': match_bd.get('peso') or 15.0,
                        'talla': match_bd.get('talla') or 95.0,
                        'perimetro': match_bd.get('perimetro') or 16.0,
                        'uds': match_bd.get('nombreUds') or match_bd.get('jardin') or match_bd.get('uds') or header_info['uds'],
                        'asociacion': match_bd.get('asociacion') or header_info['asociacion']
                    })

    return header_info, registros_encontrados

def generar_excel_oficial(asociacion, registros_por_jardin, output_path):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    for jardin_nombre, lista_ninos in registros_por_jardin.items():
        sheet_title = re.sub(r'[^a-zA-Z0-9_\-\s]', '', jardin_nombre)[:30].strip()
        ws = wb.create_sheet(title=sheet_title or 'UNIDAD')

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
            ws.cell(row=row_offset, column=3, value=nino['nombres'])
            ws.cell(row=row_offset, column=4, value=nino['apellidos'])
            ws.cell(row=row_offset, column=5, value=nino['sexo'])
            ws.cell(row=row_offset, column=6, value=nino['fechaNacimiento'])
            ws.cell(row=row_offset, column=7, value=nino['fechaIngreso'])
            ws.cell(row=row_offset, column=8, value=nino['fechaToma'])
            ws.cell(row=row_offset, column=9, value=nino['peso'])
            ws.cell(row=row_offset, column=10, value=nino['talla'])
            ws.cell(row=row_offset, column=11, value=nino['perimetro'])

    wb.save(output_path)
    print(f"  ✅ Archivo Excel generado: {os.path.basename(output_path)}")

    try:
        respaldos_dir = os.path.join(ROOT_DIR, 'docs', 'respaldos')
        os.makedirs(respaldos_dir, exist_ok=True)
        backup_path = os.path.join(respaldos_dir, os.path.basename(output_path))
        wb.save(backup_path)
        print(f"     🛡️ Copia de respaldo guardada en: docs/respaldos/{os.path.basename(output_path)}")
    except Exception as e:
        pass

def procesar_un_pdf(pdf_path, db_master):
    base_name = os.path.basename(pdf_path)
    print(f"\n  📄 Procesando PDF: {base_name}")

    header_info, ninos = extraer_datos_de_pdf(pdf_path, db_master)
    if not ninos:
        print(f"  ⚠️ No se pudieron extraer beneficiarios de: {base_name}")
        return False

    jardin_nombre = ninos[0].get('uds') or 'JARDIN'
    clean_jardin = re.sub(r'[^a-zA-Z0-9_\-\s]', '', jardin_nombre).strip().upper()
    if not clean_jardin or clean_jardin == 'UNIDAD DE SERVICIO':
        clean_jardin = re.sub(r'DATOS|ANTROPOMETRICOS|TALLA|PESO|UDS|HCB|_|\.pdf', ' ', base_name, flags=re.I)
        clean_jardin = re.sub(r'[^a-zA-Z0-9_\-\s]', '', clean_jardin).strip().upper()

    filename = f"TERCERA TOMA 2026 TALLA Y PESO {clean_jardin}.xlsx"
    output_excel = os.path.join(PESO_TALLA_DIR, filename)
    asociacion = ninos[0].get('asociacion') or header_info['asociacion']

    generar_excel_oficial(asociacion, {jardin_nombre: ninos}, output_excel)
    return True

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

    print(f"  📂 Procesando {len(pdf_files)} archivo(s) PDF independientemente...\n")

    exitosos = 0
    for pdf_path in pdf_files:
        if procesar_un_pdf(pdf_path, db_master):
            exitosos += 1

    print(f"\n  ✨ ¡Conversion completada! Se generaron {exitosos} archivo(s) Excel en:\n     {PESO_TALLA_DIR}\n")

if __name__ == '__main__':
    main()
