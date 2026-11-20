// Draws contexta's application icon: a white tag carrying two lines of "context", on a teal-to-green rounded square.
// Every size is drawn from the same shapes at its own pixel size (no scaling of a large picture), with CoreGraphics
// and ImageIO only: no window, no AppKit, nothing downloaded. Only needed if the icon is to change.
//   swift dev/make-app-icon.swift <out-folder>            writes <out-folder>/AppIcon.iconset/*.png
//   iconutil -c icns <out-folder>/AppIcon.iconset -o app/AppIcon.icns
//   swift dev/make-app-icon.swift <out-folder> --preview  also writes <out-folder>/app-icon-preview.png
// The menu-bar item does not use this icon: it stays a monochrome template symbol that macOS tints.
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: space, components: [CGFloat((hex >> 16) & 255) / 255, CGFloat((hex >> 8) & 255) / 255, CGFloat(hex & 255) / 255, alpha])!
}

/// A closed polygon with every corner rounded.
func rounded(_ points: [CGPoint], radius: CGFloat) -> CGPath {
    let path = CGMutablePath()
    let n = points.count
    let start = CGPoint(x: (points[n - 1].x + points[0].x) / 2, y: (points[n - 1].y + points[0].y) / 2)
    path.move(to: start)
    for i in 0..<n {
        path.addArc(tangent1End: points[i], tangent2End: points[(i + 1) % n], radius: radius)
    }
    path.closeSubpath()
    return path
}

/// Draws the icon into a square context `s` pixels wide, in a 1024-unit design space (origin bottom left).
func drawIcon(_ c: CGContext, _ s: Int) {
    let k = CGFloat(s) / 1024
    let small = s <= 32
    c.saveGState()
    c.scaleBy(x: k, y: k)

    // The body: Apple's grid, 824 units square with a 100-unit margin, a soft shadow under it.
    let body = CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824), cornerWidth: 186, cornerHeight: 186, transform: nil)
    c.saveGState()
    // Shadow sizes are in pixels, not in the scaled design space.
    c.setShadow(offset: CGSize(width: 0, height: -10 * k), blur: 28 * k, color: rgb(0x000000, 0.28))
    c.addPath(body); c.setFillColor(rgb(0x0E7C6B)); c.fillPath()
    c.restoreGState()
    c.saveGState()
    c.addPath(body); c.clip()
    let ground = CGGradient(colorsSpace: space, colors: [rgb(0x5FE3B4), rgb(0x1FB59A), rgb(0x0A6E68)] as CFArray, locations: [0, 0.48, 1])!
    c.drawLinearGradient(ground, start: CGPoint(x: 180, y: 940), end: CGPoint(x: 860, y: 90), options: [])
    // A faint light from the top edge.
    let sheen = CGGradient(colorsSpace: space, colors: [rgb(0xFFFFFF, 0.22), rgb(0xFFFFFF, 0)] as CFArray, locations: [0, 1])!
    c.drawLinearGradient(sheen, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 600), options: [])
    c.restoreGState()

    // The tag, pointing to the upper left.
    c.saveGState()
    c.translateBy(x: 524, y: 500)
    c.rotate(by: -.pi / 4)
    let half: CGFloat = small ? 190 : 172
    let shape = rounded([CGPoint(x: -330, y: 0), CGPoint(x: -140, y: half), CGPoint(x: 300, y: half),
                         CGPoint(x: 300, y: -half), CGPoint(x: -140, y: -half)], radius: small ? 54 : 46)
    let tag = CGMutablePath()
    tag.addPath(shape)
    let holeR: CGFloat = small ? 52 : 40
    tag.addEllipse(in: CGRect(x: -178 - holeR, y: -holeR, width: holeR * 2, height: holeR * 2))
    c.saveGState()
    c.setShadow(offset: CGSize(width: 6 * k, height: -16 * k), blur: 30 * k, color: rgb(0x053F3A, 0.35))
    c.addPath(tag); c.setFillColor(rgb(0xFFFFFF)); c.fillPath(using: .evenOdd)
    c.restoreGState()
    c.addPath(tag); c.clip(using: .evenOdd)
    let paper = CGGradient(colorsSpace: space, colors: [rgb(0xFFFFFF), rgb(0xE6F6F1)] as CFArray, locations: [0, 1])!
    c.drawLinearGradient(paper, start: CGPoint(x: 0, y: half), end: CGPoint(x: 0, y: -half), options: [])
    if !small {
        // Two lines of text on the tag: the context it carries.
        c.setLineCap(.round)
        c.setLineWidth(36)
        c.setStrokeColor(rgb(0x0F8A76))
        c.move(to: CGPoint(x: -62, y: 52)); c.addLine(to: CGPoint(x: 214, y: 52)); c.strokePath()
        c.setStrokeColor(rgb(0x0F8A76, 0.55))
        c.move(to: CGPoint(x: -62, y: -40)); c.addLine(to: CGPoint(x: 120, y: -40)); c.strokePath()
    }
    c.restoreGState()
    c.restoreGState()
}

func image(_ s: Int, _ draw: (CGContext) -> Void) -> CGImage {
    let c = CGContext(data: nil, width: s, height: s, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.interpolationQuality = .high
    c.setShouldAntialias(true)
    draw(c)
    return c.makeImage()!
}

func writePNG(_ img: CGImage, _ url: URL) {
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, [kCGImagePropertyDPIWidth: 72, kCGImagePropertyDPIHeight: 72] as CFDictionary)
    if !CGImageDestinationFinalize(dest) { fatalError("could not write \(url.path)") }
}

let args = CommandLine.arguments.dropFirst()
guard let outArg = args.first(where: { !$0.hasPrefix("--") }) else {
    print("usage: swift dev/make-app-icon.swift <out-folder> [--preview]"); exit(2)
}
let out = URL(fileURLWithPath: outArg)
let set = out.appendingPathComponent("AppIcon.iconset")
try? FileManager.default.removeItem(at: set)
try! FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)
// The ten images macOS expects in an .icns: 16, 32, 128, 256 and 512 points, each at 1x and 2x (2x of 512 is 1024).
var drawn: [Int: CGImage] = [:]
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let px = points * scale
        let img = drawn[px] ?? image(px) { drawIcon($0, px) }
        drawn[px] = img
        writePNG(img, set.appendingPathComponent("icon_\(points)x\(points)" + (scale == 2 ? "@2x" : "") + ".png"))
    }
}
print("\(set.path): 10 images, 16 to 1024 pixels")

if args.contains("--preview") {
    // Every size at its own pixel size on a light and a dark strip, and the 1024 one large.
    let sizes = [16, 32, 64, 128, 256]
    let w = 40 + 512 + 40 + sizes.reduce(0) { $0 + $1 + 24 } + 16, h = 40 + 512 + 40
    let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.setFillColor(rgb(0xF2F3F5)); c.fill(CGRect(x: 0, y: 0, width: w, height: h))
    c.setFillColor(rgb(0x1E1F22)); c.fill(CGRect(x: 0, y: 0, width: w, height: h / 2 - 6))
    c.interpolationQuality = .high
    c.draw(drawn[1024]!, in: CGRect(x: 40, y: 40, width: 512, height: 512))
    var x = 40 + 512 + 40
    for px in sizes {
        let img = drawn[px]!
        c.draw(img, in: CGRect(x: x, y: h / 2 + 20, width: px, height: px))           // on light
        c.draw(img, in: CGRect(x: x, y: h / 2 - 26 - px, width: px, height: px))      // on dark
        x += px + 24
    }
    writePNG(c.makeImage()!, out.appendingPathComponent("app-icon-preview.png"))
    print("\(out.appendingPathComponent("app-icon-preview.png").path)")
}
