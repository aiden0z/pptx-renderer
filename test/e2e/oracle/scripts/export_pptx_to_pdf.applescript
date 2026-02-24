on run argv
    if (count of argv) is not 2 then
        error "Usage: osascript export_pptx_to_pdf.applescript <input-pptx> <output-pdf>"
    end if

    set inPath to POSIX file (item 1 of argv)
    set outPath to POSIX file (item 2 of argv)

    tell application "Microsoft PowerPoint"
        activate
        open inPath
        save active presentation in outPath as save as PDF
        close active presentation saving no
    end tell
end run
