"""Write an XLSX workbook using the Python standard library."""
from io import BytesIO
import json
import re
import sys
from xml.etree.ElementTree import Element, SubElement, tostring
from zipfile import ZipFile, ZIP_DEFLATED

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
headers = ["图纸名称","图纸编号","区域","阀门编号","阀门名称","类型","型号","生产厂家",
           "公称压力","公称通径","制造日期","备注","定位状态","X（0–1）","Y（0–1）",
           "X（像素）","Y（像素）","图纸宽（像素）","图纸高（像素）","记录ID"]


def column(index):
    result = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result


def worksheet(rows, widths):
    root = Element("worksheet", xmlns=NS)
    views = SubElement(root,"sheetViews")
    view = SubElement(views,"sheetView",workbookViewId="0")
    SubElement(view,"pane",ySplit="1",topLeftCell="A2",activePane="bottomLeft",state="frozen")
    cols = SubElement(root,"cols")
    for index,width in enumerate(widths,1):
        SubElement(cols,"col",min=str(index),max=str(index),width=str(width),customWidth="1")
    data = SubElement(root,"sheetData")
    for n,values in enumerate(rows,1):
        row = SubElement(data,"row",r=str(n),ht="28" if n==1 else "36",customHeight="1")
        for i,value in enumerate(values,1):
            cell = SubElement(row,"c",r=column(i)+str(n),s="1" if n==1 else "0")
            if isinstance(value,(int,float)):
                SubElement(cell,"v").text = str(value)
            else:
                cell.set("t","inlineStr")
                text = SubElement(SubElement(cell,"is"),"t")
                text.set("{http://www.w3.org/XML/1998/namespace}space","preserve")
                text.text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]","",str(value or ""))
    SubElement(root,"autoFilter",ref="A1:"+column(len(rows[0]))+str(len(rows)))
    return tostring(root,encoding="utf-8",xml_declaration=True)


records = json.load(sys.stdin.buffer)
rows = [headers]
for v in records:
    f=v["fields"]
    located=v["x"] is not None
    rows.append([v["plan"],v["planId"],v["regions"],"V-"+str(v["seq"]).zfill(2),
                 *[f.get(k,"") for k in ["name","type","model","maker","pressure","diameter","date","notes"]],
                 "已定位" if located else "待定位",v["x"] if located else "",v["y"] if located else "",
                 round(v["x"]*v["width"],2) if located and v["width"] else "",
                 round(v["y"]*v["height"],2) if located and v["height"] else "",
                 v["width"],v["height"],v["id"]])
notes = [["项目","说明"],["坐标原点","原始图纸左上角，X 向右、Y 向下。"],
         ["标准化坐标","X、Y 范围为 0 到 1，相对于原始图纸宽高。"],
         ["像素坐标","标准化坐标乘以图纸像素宽高，保留两位小数。"],
         ["区域归属","按点位是否位于区域框内计算。重叠区域会同时列出。"],
         ["待定位","坐标为空，可在网页选中阀门后定位。"],
         ["导出数量",len(records)]]
types = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
root_rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
workbook = '<workbook xmlns="'+NS+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="阀门信息" sheetId="1" r:id="rId1"/><sheet name="坐标说明" sheetId="2" r:id="rId2"/></sheets></workbook>'
rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
styles = '<styleSheet xmlns="'+NS+'"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF193F3C"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
output=BytesIO()
with ZipFile(output,"w",ZIP_DEFLATED) as archive:
    for name,content in {"[Content_Types].xml":types,"_rels/.rels":root_rels,"xl/workbook.xml":workbook,
                         "xl/_rels/workbook.xml.rels":rels,"xl/styles.xml":styles,
                         "xl/worksheets/sheet1.xml":worksheet(rows,[24,22,24,12,34,14,24,34,16,16,18,48,14,18,18,18,18,18,18,40]),
                         "xl/worksheets/sheet2.xml":worksheet(notes,[24,85])}.items():
        archive.writestr(name,content)
sys.stdout.buffer.write(output.getvalue())
