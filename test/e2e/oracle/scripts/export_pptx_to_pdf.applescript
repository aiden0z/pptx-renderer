on run argv
    if (count of argv) is not 2 then
        error "Usage: osascript export_pptx_to_pdf.applescript <input-pptx> <output-pdf>"
    end if

    set inputPosixPath to item 1 of argv
    set inPath to POSIX file inputPosixPath
    set outPath to POSIX file (item 2 of argv)

    set openedPresentation to missing value
    tell application "Microsoft PowerPoint"
        activate
        try
            open inPath
            set presentationPaths to (get full name of every presentation)
            repeat with presentationIndex from 1 to count of presentationPaths
                if (item presentationIndex of presentationPaths as text) is inputPosixPath then
                    set openedPresentation to presentation presentationIndex
                    exit repeat
                end if
            end repeat
            if openedPresentation is missing value then
                error "PowerPoint opened the input but no presentation matched: " & inputPosixPath
            end if
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
