on run argv
    if (count of argv) is not 2 then
        error "Usage: osascript export_pptx_to_pdf.applescript <input-pptx> <output-pdf>"
    end if

    set inPath to POSIX file (item 1 of argv)
    set outPath to POSIX file (item 2 of argv)

    set openedPresentation to missing value
    tell application "Microsoft PowerPoint"
        activate
        try
            open inPath
            set openedPresentation to active presentation
            save openedPresentation in outPath as save as PDF
            close openedPresentation saving no
        on error errorMessage number errorNumber
            if openedPresentation is not missing value then
                try
                    close openedPresentation saving no
                end try
            end if
            error errorMessage number errorNumber
        end try
    end tell
end run
