// lla_ocr — Motor OCR LOCAL para Locked Legal Advisor.
//
// Usa los frameworks nativos de macOS: PDFKit (rasteriza páginas de PDF) +
// Vision (VNRecognizeTextRequest, reconocimiento óptico de alta calidad en
// español+inglés). 100% LOCAL y OFFLINE (Regla 2: sin red en la lógica) y NUNCA
// inventa: emite solo el texto que Vision reconoce, con su confianza real
// (Regla 4). Si no reconoce nada, devuelve texto vacío y baja confianza.
//
// Uso:
//   lla_ocr <archivo.pdf|imagen> [--max-pages N] [--langs es-ES,en-US] [--scale 2.5]
// Salida (stdout): JSON { engine, file, kind, page_count, processed_pages,
//                         pages:[{page,text,confidence}], text, mean_confidence }
// Código de salida 0 = OK; !=0 = error (el llamante lo trata como fallo, sin inventar).

import Foundation
import Vision
import PDFKit
import CoreGraphics
import ImageIO

struct PageOut: Codable { let page: Int; let text: String; let confidence: Double; let method: String }
struct Result: Codable {
    let engine: String
    let file: String
    let kind: String
    let page_count: Int
    let processed_pages: Int
    let pages: [PageOut]
    let text: String
    let mean_confidence: Double
    let extraction_method: String   // native_text | ocr | native_plus_ocr | manual_description_needed
    let confidence: String          // low | medium | high
}

func letterCount(_ s: String) -> Int { s.reduce(0) { $0 + ($1.isLetter ? 1 : 0) } }

func fail(_ msg: String) -> Never {
    let j = "{\"engine\":\"apple-vision\",\"error\":\(jsonString(msg))}"
    FileHandle.standardError.write(Data((msg + "\n").utf8))
    print(j)
    exit(2)
}

func jsonString(_ s: String) -> String {
    let data = try? JSONEncoder().encode(s)
    return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
}

// OCR de una CGImage → (texto, confianza media). Vision, sincrónico.
func ocr(_ cg: CGImage, langs: [String]) -> (String, Double) {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    if !langs.isEmpty { req.recognitionLanguages = langs }
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { return ("", 0) }
    guard let obs = req.results else { return ("", 0) }
    var lines: [String] = []
    var confs: [Double] = []
    for o in obs {
        if let top = o.topCandidates(1).first {
            lines.append(top.string)
            confs.append(Double(top.confidence))
        }
    }
    let text = lines.joined(separator: "\n")
    let mean = confs.isEmpty ? 0.0 : confs.reduce(0, +) / Double(confs.count)
    return (text, mean)
}

// Rasteriza una página de PDF a CGImage (fondo blanco, escala dada).
func render(_ page: PDFPage, scale: CGFloat) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let w = Int((bounds.width * scale).rounded())
    let h = Int((bounds.height * scale).rounded())
    guard w > 0, h > 0, w * h < 80_000_000 else { return nil } // tope de seguridad
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: 0, space: cs,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    ctx.translateBy(x: -bounds.origin.x, y: -bounds.origin.y)
    page.draw(with: .mediaBox, to: ctx)
    return ctx.makeImage()
}

func loadImage(_ path: String) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

// ---- args ----
var args = Array(CommandLine.arguments.dropFirst())
guard let path = args.first(where: { !$0.hasPrefix("--") }) else {
    fail("uso: lla_ocr <archivo> [--max-pages N] [--langs es-ES,en-US] [--scale 2.5]")
}
func opt(_ name: String, _ def: String) -> String {
    if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }
    return def
}
let maxPages = max(1, Int(opt("--max-pages", "60")) ?? 60)
let langs = opt("--langs", "es-ES,en-US").split(separator: ",").map(String.init)
let scale = CGFloat(Double(opt("--scale", "2.5")) ?? 2.5)

guard FileManager.default.fileExists(atPath: path) else { fail("archivo no encontrado: \(path)") }
let ext = (path as NSString).pathExtension.lowercased()

var pages: [PageOut] = []
var kind = "image"
var pageCount = 1

// Umbral de letras por página para considerarla "capa de texto nativa" (digital).
let NATIVE_PAGE_MIN = 20

if ext == "pdf" {
    kind = "pdf"
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { fail("no es un PDF legible") }
    pageCount = doc.pageCount
    let n = min(pageCount, maxPages)
    for i in 0..<n {
        autoreleasepool {
            guard let page = doc.page(at: i) else {
                pages.append(PageOut(page: i + 1, text: "", confidence: 0, method: "manual_description_needed")); return
            }
            // 1) Capa de texto nativa (PDFKit) — rápida, fiel, sin OCR.
            let native = page.string ?? ""
            if letterCount(native) >= NATIVE_PAGE_MIN {
                pages.append(PageOut(page: i + 1, text: native, confidence: 1.0, method: "native_text")); return
            }
            // 2) Página escaneada → OCR con Vision.
            guard let img = render(page, scale: scale) else {
                pages.append(PageOut(page: i + 1, text: "", confidence: 0, method: "manual_description_needed")); return
            }
            let (t, c) = ocr(img, langs: langs)
            pages.append(PageOut(page: i + 1, text: t,
                                 confidence: c,
                                 method: letterCount(t) > 0 ? "ocr" : "manual_description_needed"))
        }
    }
} else {
    guard let img = loadImage(path) else { fail("no es una imagen legible") }
    let (t, c) = ocr(img, langs: langs)
    pages.append(PageOut(page: 1, text: t, confidence: c,
                         method: letterCount(t) > 0 ? "ocr" : "manual_description_needed"))
}

let joined = pages.map { $0.text }.filter { !$0.isEmpty }.joined(separator: "\n\n")
let confs = pages.map { $0.confidence }.filter { $0 > 0 }
let mean = confs.isEmpty ? 0.0 : confs.reduce(0, +) / Double(confs.count)

// Método global a partir de los métodos por página.
let methods = Set(pages.filter { letterCount($0.text) > 0 }.map { $0.method })
let extractionMethod: String
if methods.isEmpty { extractionMethod = "manual_description_needed" }
else if methods == ["native_text"] { extractionMethod = "native_text" }
else if methods == ["ocr"] { extractionMethod = "ocr" }
else if methods.contains("native_text") && methods.contains("ocr") { extractionMethod = "native_plus_ocr" }
else { extractionMethod = methods.first ?? "manual_description_needed" }

// Confianza global (low/medium/high). Texto nativo => alta; OCR según Vision.
let confidenceLabel: String
if letterCount(joined) == 0 { confidenceLabel = "low" }
else if extractionMethod == "native_text" { confidenceLabel = "high" }
else if mean >= 0.80 { confidenceLabel = "high" }
else if mean >= 0.50 { confidenceLabel = "medium" }
else { confidenceLabel = "low" }

let result = Result(engine: "apple-vision", file: path, kind: kind,
                    page_count: pageCount, processed_pages: pages.count,
                    pages: pages, text: joined, mean_confidence: mean,
                    extraction_method: extractionMethod, confidence: confidenceLabel)
let enc = JSONEncoder()
let data = (try? enc.encode(result)) ?? Data("{}".utf8)
print(String(data: data, encoding: .utf8) ?? "{}")
