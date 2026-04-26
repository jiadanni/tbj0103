import AVFoundation
import Foundation
import Speech

// MARK: - Voice Transcription Service

@MainActor
class VoiceTranscriptionService: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var isTranscribing = false
    @Published var transcribedText = ""
    @Published var permissionGranted = false

    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

    override init() {
        super.init()
        requestPermissions()
    }

    // MARK: - Permissions

    func requestPermissions() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                self?.permissionGranted = (status == .authorized)
            }
        }
    }

    // MARK: - Recording

    func startRecording() throws {
        guard permissionGranted else {
            throw TranscriptionError.permissionDenied
        }

        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            throw TranscriptionError.recognizerUnavailable
        }

        // Cancel existing task
        recognitionTask?.cancel()
        recognitionTask = nil

        // Configure audio session (iOS only)
#if os(iOS)
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
#endif

        // Create recognition request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()

        guard let recognitionRequest = recognitionRequest else {
            throw TranscriptionError.requestCreationFailed
        }

        recognitionRequest.shouldReportPartialResults = true

        // Configure audio engine
        audioEngine = AVAudioEngine()

        guard let audioEngine = audioEngine else {
            throw TranscriptionError.audioEngineCreationFailed
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            recognitionRequest.append(buffer)
        }

        // Start recognition task
        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            Task { @MainActor in
                guard let self = self else { return }

                if let result = result {
                    self.transcribedText = result.bestTranscription.formattedString
                    self.isTranscribing = !result.isFinal
                }

                if error != nil || result?.isFinal == true {
                    self.stopRecording()
                }
            }
        }

        // Start audio engine
        audioEngine.prepare()
        try audioEngine.start()

        isRecording = true
        isTranscribing = true
    }

    func stopRecording() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()

        isRecording = false
        isTranscribing = false
    }

    // MARK: - File Transcription

    func transcribeAudioFile(at url: URL) async throws -> String {
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            throw TranscriptionError.recognizerUnavailable
        }

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false

        return try await withCheckedThrowingContinuation { continuation in
            recognitionTask = speechRecognizer.recognitionTask(with: request) { result, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                if let result = result, result.isFinal {
                    continuation.resume(returning: result.bestTranscription.formattedString)
                }
            }
        }
    }
}

// MARK: - Errors

enum TranscriptionError: Error, LocalizedError {
    case permissionDenied
    case recognizerUnavailable
    case requestCreationFailed
    case audioEngineCreationFailed

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Microphone or speech recognition permission denied"
        case .recognizerUnavailable:
            return "Speech recognizer is not available"
        case .requestCreationFailed:
            return "Failed to create recognition request"
        case .audioEngineCreationFailed:
            return "Failed to create audio engine"
        }
    }
}
