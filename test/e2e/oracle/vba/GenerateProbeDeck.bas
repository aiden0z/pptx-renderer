Attribute VB_Name = "GenerateProbeDeck"
Option Explicit

' One-shot probe: create a new presentation, insert representative AutoShapes + one SmartArt,
' save as PPTX and export PDF.
Public Sub GenerateProbeDeck_Run(outputPptxPath As String, outputPdfPath As String)
    Dim pres As Presentation
    Dim sld As Slide
    Dim smartLayout As SmartArtLayout

    Set pres = Application.Presentations.Add
    Set sld = pres.Slides.Add(1, ppLayoutBlank)

    ' Basic shapes
    sld.Shapes.AddShape msoShapeRectangle, 40, 50, 180, 80
    sld.Shapes.AddShape msoShapeRoundedRectangle, 250, 50, 200, 80
    sld.Shapes.AddShape msoShapeChevron, 480, 50, 180, 80
    sld.Shapes.AddShape msoShapeDiamond, 60, 170, 140, 100
    sld.Shapes.AddShape msoShapeDonut, 250, 165, 130, 110
    sld.Shapes.AddShape msoShapeIsoscelesTriangle, 450, 165, 150, 110
    sld.Shapes.AddShape msoShapeRightArrow, 60, 320, 220, 80
    sld.Shapes.AddShape msoShapeCloudCallout, 320, 300, 220, 120

    Set smartLayout = ResolveSmartArtLayout("urn:microsoft.com/office/officeart/2005/8/layout/BasicProcess")
    If Not smartLayout Is Nothing Then
        sld.Shapes.AddSmartArt smartLayout, 560, 280, 280, 180
    End If

    pres.SaveAs outputPptxPath, ppSaveAsOpenXMLPresentation
    pres.SaveAs outputPdfPath, ppSaveAsPDF
    pres.Close
End Sub

' Probe which MsoAutoShapeType numeric IDs are valid on this PowerPoint build.
' Tries AddShape for each ID in [minId, maxId], records valid ones to outputPath.
' Output format (one per line): ID|ShapeName  (e.g. "1|Rectangle")
' ShapeName is the auto-assigned name with trailing number stripped.
' Runs in a single PowerPoint session — fast even for 500 IDs.
Public Sub ProbeValidShapeIds(outputPath As String, minId As String, maxId As String)
    Dim pres As Presentation
    Dim sld As Slide
    Dim fnum As Integer
    Dim i As Long
    Dim shp As Shape
    Dim lo As Long
    Dim hi As Long
    Dim baseName As String
    Dim spacePos As Long

    lo = CLng(minId)
    hi = CLng(maxId)

    Set pres = Application.Presentations.Add
    Set sld = pres.Slides.Add(1, ppLayoutBlank)

    fnum = FreeFile
    Open outputPath For Output As #fnum

    For i = lo To hi
        On Error Resume Next
        Set shp = sld.Shapes.AddShape(i, 100, 100, 200, 150)
        If Err.Number = 0 Then
            ' Extract base name: "Rectangle 1" -> "Rectangle"
            baseName = shp.Name
            spacePos = InStrRev(baseName, " ")
            If spacePos > 0 Then
                If IsIntegerText(Mid$(baseName, spacePos + 1)) Then
                    baseName = Left$(baseName, spacePos - 1)
                End If
            End If
            Print #fnum, CStr(i) & "|" & baseName
            shp.Delete
        Else
            Err.Clear
        End If
        Set shp = Nothing
        On Error GoTo 0
    Next i

    Close #fnum
    pres.Close
    Set pres = Nothing
End Sub

' No-arg wrapper so the macro appears in Tools -> Macro -> Macros on macOS.
Public Sub GenerateProbeDeck_Default()
    Dim baseDir As String
    #If Mac Then
        baseDir = Environ$("HOME") & "/Documents/pptx-renderer-probe"
    #Else
        baseDir = Environ$("USERPROFILE") & "\Documents\pptx-renderer-probe"
    #End If
    On Error Resume Next
    MkDir baseDir
    On Error GoTo 0

    Call GenerateProbeDeck_Run(baseDir & "/pptx-generated-by-vba.pptx", baseDir & "/pptx-generated-by-vba.pdf")
End Sub

' Export all SmartArt layout identifiers available on this PowerPoint build.
' Output format (one per line): Id|Name
Public Sub ExportSmartArtLayouts_ToFile(outputPath As String)
    Dim fnum As Integer
    Dim layouts As SmartArtLayouts
    Dim layoutObj As SmartArtLayout
    Dim idVal As String
    Dim nameVal As String

    Set layouts = Application.SmartArtLayouts
    fnum = FreeFile
    Open outputPath For Output As #fnum

    For Each layoutObj In layouts
        idVal = GetObjectPropString(layoutObj, "Id")
        nameVal = GetObjectPropString(layoutObj, "Name")
        Print #fnum, idVal & "|" & nameVal
    Next layoutObj

    Close #fnum
End Sub

' Spec-driven generator entrypoint.
' Spec format (line-based):
' OUT_PPTX|/abs/path/out.pptx
' OUT_PDF|/abs/path/out.pdf
' SLIDE
' SHAPE|RECTANGLE|40|50|180|80
' SMARTART|urn:...|320|220|260|140
' TEXTBOX|hello|50|420|300|60
Public Sub GenerateProbeDeck_FromSpec(specPath As String)
    Dim pres As Presentation
    Dim sld As Slide
    Dim outPptx As String
    Dim outPdf As String
    Dim outPngPrefix As String
    Dim pngWidth As Long
    Dim pngHeight As Long
    Dim fnum As Integer
    Dim fileOpen As Boolean
    Dim lineText As String
    Dim errNumber As Long
    Dim errDescription As String

    On Error GoTo CleanFail
    Set pres = Application.Presentations.Add
    outPptx = ""
    outPdf = ""
    outPngPrefix = ""
    pngWidth = 0
    pngHeight = 0
    fileOpen = False

    fnum = FreeFile
    Open specPath For Input As #fnum
    fileOpen = True

    Do While Not EOF(fnum)
        Line Input #fnum, lineText
        lineText = Trim$(lineText)
        If Len(lineText) = 0 Then GoTo ContinueLoop

        If StartsWith(lineText, "OUT_PPTX|") Then
            outPptx = Mid$(lineText, Len("OUT_PPTX|") + 1)
        ElseIf StartsWith(lineText, "OUT_PDF|") Then
            outPdf = Mid$(lineText, Len("OUT_PDF|") + 1)
        ElseIf StartsWith(lineText, "OUT_PNG|") Then
            ' Format: OUT_PNG|prefix|width|height
            ' Exports each slide as prefix_slide1.png, prefix_slide2.png, ...
            Dim pngParts() As String
            pngParts = Split(Mid$(lineText, Len("OUT_PNG|") + 1), "|")
            outPngPrefix = pngParts(0)
            If UBound(pngParts) >= 1 Then pngWidth = CLng(pngParts(1))
            If UBound(pngParts) >= 2 Then pngHeight = CLng(pngParts(2))
        ElseIf lineText = "SLIDE" Then
            Set sld = pres.Slides.Add(pres.Slides.Count + 1, ppLayoutBlank)
        ElseIf StartsWith(lineText, "SHAPE|") Then
            If sld Is Nothing Then Set sld = pres.Slides.Add(1, ppLayoutBlank)
            AddShapeFromSpec sld, lineText
        ElseIf StartsWith(lineText, "SMARTART|") Then
            If sld Is Nothing Then Set sld = pres.Slides.Add(1, ppLayoutBlank)
            AddSmartArtFromSpec sld, lineText
        ElseIf StartsWith(lineText, "TEXTBOX|") Then
            If sld Is Nothing Then Set sld = pres.Slides.Add(1, ppLayoutBlank)
            AddTextboxFromSpec sld, lineText
        ElseIf StartsWith(lineText, "CHART|") Then
            #If Mac Then
                ' macOS PowerPoint lacks embedded Excel engine; skip chart creation silently.
            #Else
                If sld Is Nothing Then Set sld = pres.Slides.Add(1, ppLayoutBlank)
                AddChartFromSpec sld, lineText
            #End If
        ElseIf StartsWith(lineText, "TABLE|") Then
            If sld Is Nothing Then Set sld = pres.Slides.Add(1, ppLayoutBlank)
            AddTableFromSpec sld, lineText
        ElseIf StartsWith(lineText, "CONNECTOR|") Then
            If sld Is Nothing Then Set sld = pres.Slides.Add(1, ppLayoutBlank)
            AddConnectorFromSpec sld, lineText
        ElseIf StartsWith(lineText, "FILLSTROKE|") Then
            If sld Is Nothing Then Set sld = pres.Slides.Add(1, ppLayoutBlank)
            AddFillStrokeFromSpec sld, lineText
        End If

ContinueLoop:
    Loop

    Close #fnum
    fileOpen = False

    If Len(outPptx) = 0 Then Err.Raise 5, , "OUT_PPTX missing in spec"
    If Len(outPdf) = 0 Then Err.Raise 5, , "OUT_PDF missing in spec"

    pres.SaveAs outPptx, ppSaveAsOpenXMLPresentation
    pres.SaveAs outPdf, ppSaveAsPDF

    ' Export each slide as PNG if OUT_PNG was specified
    If Len(outPngPrefix) > 0 Then
        Dim slideIdx As Long
        Dim pngPath As String
        For slideIdx = 1 To pres.Slides.Count
            pngPath = outPngPrefix & "_slide" & CStr(slideIdx) & ".png"
            If pngWidth > 0 And pngHeight > 0 Then
                pres.Slides(slideIdx).Export pngPath, "PNG", pngWidth, pngHeight
            ElseIf pngWidth > 0 Then
                pres.Slides(slideIdx).Export pngPath, "PNG", pngWidth
            Else
                ' Default: 96 DPI (1280x720 for widescreen)
                pres.Slides(slideIdx).Export pngPath, "PNG"
            End If
        Next slideIdx
    End If

    pres.Close
    Set pres = Nothing
    GoTo CleanExit

CleanFail:
    errNumber = Err.Number
    errDescription = Err.Description

CleanExit:
    On Error Resume Next
    If fileOpen Then Close #fnum
    If Not pres Is Nothing Then pres.Close
    On Error GoTo 0
    If errNumber <> 0 Then
        ' Do not re-raise here.
        ' Re-raising can surface modal VBA/runtime dialogs that block unattended batch runs.
        ' Caller already treats missing sink outputs as case failure and will continue.
        Exit Sub
    End If
End Sub

Private Sub AddShapeFromSpec(ByVal sld As Slide, ByVal lineText As String)
    Dim t() As String
    Dim shapeToken As String
    Dim rawType As Long
    t = Split(lineText, "|")
    If UBound(t) < 5 Then Exit Sub

    Dim shapeType As MsoAutoShapeType
    shapeToken = Trim$(t(1))
    If IsIntegerText(shapeToken) Then
        rawType = CLng(shapeToken)
        If rawType < 1 Or rawType > 500 Then
            Err.Raise 5, "AddShapeFromSpec", "SHAPE type id out of range: " & shapeToken & " in line: " & lineText
        End If
        shapeType = rawType
    Else
        shapeType = ResolveShapeType(shapeToken)
    End If

    On Error GoTo ShapeFail
    sld.Shapes.AddShape shapeType, CSng(t(2)), CSng(t(3)), CSng(t(4)), CSng(t(5))
    On Error GoTo 0
    Exit Sub

ShapeFail:
    Err.Raise Err.Number, "AddShapeFromSpec", "Failed to add shape from line: " & lineText & " (" & Err.Description & ")"
End Sub

Private Sub AddSmartArtFromSpec(ByVal sld As Slide, ByVal lineText As String)
    Dim t() As String
    Dim layout As SmartArtLayout
    Dim shp As Shape
    t = Split(lineText, "|")
    If UBound(t) < 5 Then Err.Raise 5, , "SMARTART line requires 6 fields: " & lineText

    Set layout = ResolveSmartArtLayout(t(1))
    If layout Is Nothing Then
        Err.Raise 5, , "SMARTART layout not found on this PowerPoint build: " & t(1)
    End If

    Set shp = sld.Shapes.AddSmartArt(layout, CSng(t(2)), CSng(t(3)), CSng(t(4)), CSng(t(5)))
    If shp Is Nothing Then
        Err.Raise 5, , "SMARTART insertion returned Nothing for layout: " & t(1)
    End If
End Sub

Private Sub AddTextboxFromSpec(ByVal sld As Slide, ByVal lineText As String)
    Dim t() As String
    Dim shp As Shape
    t = Split(lineText, "|")
    If UBound(t) < 5 Then Exit Sub

    Set shp = sld.Shapes.AddTextbox(msoTextOrientationHorizontal, CSng(t(2)), CSng(t(3)), CSng(t(4)), CSng(t(5)))
    shp.TextFrame.TextRange.Text = t(1)
End Sub

Private Sub AddChartFromSpec(ByVal sld As Slide, ByVal lineText As String)
    Dim t() As String
    t = Split(lineText, "|")
    If UBound(t) < 5 Then Exit Sub

    Dim chartType As Long
    chartType = CLng(t(1))

    On Error GoTo ChartFail
    sld.Shapes.AddChart chartType, CSng(t(2)), CSng(t(3)), CSng(t(4)), CSng(t(5))
    On Error GoTo 0
    Exit Sub

ChartFail:
    Err.Raise Err.Number, "AddChartFromSpec", "Failed to add chart from line: " & lineText & " (" & Err.Description & ")"
End Sub

Private Sub AddTableFromSpec(ByVal sld As Slide, ByVal lineText As String)
    Dim t() As String
    t = Split(lineText, "|")
    If UBound(t) < 6 Then Exit Sub

    On Error GoTo TableFail
    sld.Shapes.AddTable CLng(t(1)), CLng(t(2)), CSng(t(3)), CSng(t(4)), CSng(t(5)), CSng(t(6))
    On Error GoTo 0
    Exit Sub

TableFail:
    Err.Raise Err.Number, "AddTableFromSpec", "Failed to add table from line: " & lineText & " (" & Err.Description & ")"
End Sub

Private Sub AddConnectorFromSpec(ByVal sld As Slide, ByVal lineText As String)
    Dim t() As String
    t = Split(lineText, "|")
    If UBound(t) < 5 Then Exit Sub

    On Error GoTo ConnFail
    sld.Shapes.AddConnector CLng(t(1)), CSng(t(2)), CSng(t(3)), CSng(t(4)), CSng(t(5))
    On Error GoTo 0
    Exit Sub

ConnFail:
    Err.Raise Err.Number, "AddConnectorFromSpec", "Failed to add connector from line: " & lineText & " (" & Err.Description & ")"
End Sub

Private Sub AddFillStrokeFromSpec(ByVal sld As Slide, ByVal lineText As String)
    Dim t() As String
    t = Split(lineText, "|")
    If UBound(t) < 6 Then Exit Sub

    Dim shp As Shape
    On Error GoTo FillStrokeFail
    Set shp = sld.Shapes.AddShape(msoShapeRectangle, CSng(t(3)), CSng(t(4)), CSng(t(5)), CSng(t(6)))
    ApplyFillVariant shp, Trim$(t(1))
    ApplyStrokeVariant shp, Trim$(t(2))
    On Error GoTo 0
    Exit Sub

FillStrokeFail:
    Err.Raise Err.Number, "AddFillStrokeFromSpec", "Failed to add fill/stroke from line: " & lineText & " (" & Err.Description & ")"
End Sub

Private Sub ApplyFillVariant(ByVal shp As Shape, ByVal fillKind As String)
    Select Case LCase$(fillKind)
        Case "solid-red"
            shp.Fill.Solid
            shp.Fill.ForeColor.RGB = RGB(255, 0, 0)
        Case "solid-blue"
            shp.Fill.Solid
            shp.Fill.ForeColor.RGB = RGB(0, 0, 255)
        Case "gradient-linear"
            shp.Fill.TwoColorGradient msoGradientHorizontal, 1
            shp.Fill.ForeColor.RGB = RGB(0, 120, 215)
            shp.Fill.BackColor.RGB = RGB(255, 255, 255)
        Case "gradient-radial"
            shp.Fill.TwoColorGradient msoGradientFromCenter, 1
            shp.Fill.ForeColor.RGB = RGB(0, 176, 80)
            shp.Fill.BackColor.RGB = RGB(255, 255, 255)
        Case "pattern-cross"
            shp.Fill.Patterned msoPatternCross
            shp.Fill.ForeColor.RGB = RGB(0, 0, 0)
            shp.Fill.BackColor.RGB = RGB(255, 255, 255)
        Case "no-fill"
            shp.Fill.Visible = msoFalse
        Case Else
            ' default: leave as-is
    End Select
End Sub

Private Sub ApplyStrokeVariant(ByVal shp As Shape, ByVal strokeKind As String)
    Select Case LCase$(strokeKind)
        Case "solid-thin"
            shp.Line.Visible = msoTrue
            shp.Line.Weight = 1
            shp.Line.DashStyle = msoLineSolid
            shp.Line.ForeColor.RGB = RGB(0, 0, 0)
        Case "solid-thick"
            shp.Line.Visible = msoTrue
            shp.Line.Weight = 4
            shp.Line.DashStyle = msoLineSolid
            shp.Line.ForeColor.RGB = RGB(0, 0, 0)
        Case "dash"
            shp.Line.Visible = msoTrue
            shp.Line.Weight = 2
            shp.Line.DashStyle = msoLineDash
            shp.Line.ForeColor.RGB = RGB(0, 0, 0)
        Case "dot"
            shp.Line.Visible = msoTrue
            shp.Line.Weight = 2
            shp.Line.DashStyle = msoLineDashDot
            shp.Line.ForeColor.RGB = RGB(0, 0, 0)
        Case "dash-dot"
            shp.Line.Visible = msoTrue
            shp.Line.Weight = 2
            shp.Line.DashStyle = msoLineDashDotDot
            shp.Line.ForeColor.RGB = RGB(0, 0, 0)
        Case "no-line"
            shp.Line.Visible = msoFalse
        Case Else
            ' default: leave as-is
    End Select
End Sub

' Probe which XlChartType numeric IDs are valid on this PowerPoint build.
' XlChartType includes negative values (e.g. -4120 = xlLine), so range should span negative to positive.
' Output format (one per line): numeric ID
Public Sub ProbeValidChartTypes(outputPath As String, minId As String, maxId As String)
    Dim pres As Presentation
    Dim sld As Slide
    Dim fnum As Integer
    Dim i As Long
    Dim shp As Shape
    Dim lo As Long
    Dim hi As Long

    lo = CLng(minId)
    hi = CLng(maxId)

    Set pres = Application.Presentations.Add
    Set sld = pres.Slides.Add(1, ppLayoutBlank)

    fnum = FreeFile
    Open outputPath For Output As #fnum

    For i = lo To hi
        On Error Resume Next
        Set shp = sld.Shapes.AddChart(i, 100, 100, 300, 200)
        If Err.Number = 0 Then
            Print #fnum, CStr(i)
            shp.Delete
        Else
            Err.Clear
        End If
        Set shp = Nothing
        On Error GoTo 0
    Next i

    Close #fnum
    pres.Close
    Set pres = Nothing
End Sub

Private Function ResolveShapeType(ByVal name As String) As MsoAutoShapeType
    Select Case UCase$(name)
        Case "RECTANGLE": ResolveShapeType = msoShapeRectangle
        Case "ROUNDED_RECTANGLE": ResolveShapeType = msoShapeRoundedRectangle
        Case "CHEVRON": ResolveShapeType = msoShapeChevron
        Case "DIAMOND": ResolveShapeType = msoShapeDiamond
        Case "DONUT": ResolveShapeType = msoShapeDonut
        Case "ISOSCELES_TRIANGLE": ResolveShapeType = msoShapeIsoscelesTriangle
        Case "RIGHT_ARROW": ResolveShapeType = msoShapeRightArrow
        Case "LEFT_RIGHT_ARROW": ResolveShapeType = msoShapeLeftRightArrow
        Case "CURVED_RIGHT_ARROW": ResolveShapeType = msoShapeCurvedRightArrow
        Case "UTURN_ARROW": ResolveShapeType = msoShapeUTurnArrow
        Case "CLOUD_CALLOUT": ResolveShapeType = msoShapeCloudCallout
        Case "CAN": ResolveShapeType = msoShapeCan
        Case "CUBE": ResolveShapeType = msoShapeCube
        Case "FOLDED_CORNER": ResolveShapeType = msoShapeFoldedCorner
        Case "SMILEY_FACE": ResolveShapeType = msoShapeSmileyFace
        Case "LIGHTNING_BOLT": ResolveShapeType = msoShapeLightningBolt
        Case "HEART": ResolveShapeType = msoShapeHeart
        Case "SUN": ResolveShapeType = msoShapeSun
        Case "MOON": ResolveShapeType = msoShapeMoon
        Case "FLOWCHART_DECISION": ResolveShapeType = msoShapeFlowchartDecision
        Case "FLOWCHART_TERMINATOR": ResolveShapeType = msoShapeFlowchartTerminator
        Case Else: Err.Raise 5, "ResolveShapeType", "Unsupported SHAPE token: " & name
    End Select
End Function

Private Function ResolveSmartArtLayout(ByVal layoutKey As String) As SmartArtLayout
    Dim layouts As SmartArtLayouts
    Dim layoutObj As SmartArtLayout
    Dim key As String
    Dim keyCompact As String
    Dim idVal As String
    Dim nameVal As String
    Dim i As Long

    Set layouts = Application.SmartArtLayouts

    On Error Resume Next
    Set ResolveSmartArtLayout = layouts(layoutKey)
    On Error GoTo 0
    If Not ResolveSmartArtLayout Is Nothing Then Exit Function

    key = LCase$(Trim$(layoutKey))
    keyCompact = Replace$(key, " ", "")
    If InStrRev(keyCompact, "/") > 0 Then
        keyCompact = Mid$(keyCompact, InStrRev(keyCompact, "/") + 1)
    End If

    For i = 1 To layouts.Count
        Set layoutObj = layouts(i)
        idVal = LCase$(GetObjectPropString(layoutObj, "Id"))
        nameVal = LCase$(GetObjectPropString(layoutObj, "Name"))
        If Replace$(idVal, " ", "") = keyCompact Or Replace$(nameVal, " ", "") = keyCompact Then
            Set ResolveSmartArtLayout = layoutObj
            Exit Function
        End If
    Next i

End Function

Private Function GetObjectPropString(ByVal obj As Object, ByVal propName As String) As String
    On Error Resume Next
    GetObjectPropString = CStr(CallByName(obj, propName, VbGet))
    If Err.Number <> 0 Then
        GetObjectPropString = ""
        Err.Clear
    End If
    On Error GoTo 0
End Function

Private Function StartsWith(ByVal s As String, ByVal prefix As String) As Boolean
    StartsWith = (Left$(s, Len(prefix)) = prefix)
End Function

Private Function IsIntegerText(ByVal s As String) As Boolean
    Dim i As Long
    Dim c As String
    s = Trim$(s)
    If Len(s) = 0 Then Exit Function
    If Left$(s, 1) = "-" Then
        If Len(s) = 1 Then Exit Function
        s = Mid$(s, 2)
    End If
    For i = 1 To Len(s)
        c = Mid$(s, i, 1)
        If c < "0" Or c > "9" Then Exit Function
    Next i
    IsIntegerText = True
End Function
