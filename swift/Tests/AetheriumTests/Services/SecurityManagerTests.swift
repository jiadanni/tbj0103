@testable import Aetherium
import XCTest

@MainActor
final class SecurityManagerTests: XCTestCase {
    var securityManager: SecurityManager!

    override func setUp() {
        super.setUp()
        securityManager = SecurityManager()
        // Reset state
        securityManager.isAuthenticated = false
        securityManager.autoLockMinutes = 0
        securityManager.cancelAutoLockTimer()
    }

    override func tearDown() {
        securityManager.cancelAutoLockTimer()
        securityManager = nil
        super.tearDown()
    }

    func testSetupAutoLock_UpdatesMinutes() {
        // Arrange
        let minutes = 5

        // Act
        securityManager.setupAutoLock(after: minutes)

        // Assert
        XCTAssertEqual(securityManager.autoLockMinutes, minutes)
    }

    func testSetupAutoLock_SetsObservers() {
        // Arrange
        let minutes = 10

        // Act
        securityManager.setupAutoLock(after: minutes)

        // Assert
        XCTAssertNotNil(securityManager.resignObserver)
        XCTAssertNotNil(securityManager.becomeActiveObserver)
    }

    func testSetupAutoLock_RemovesObservers() {
        // Arrange
        securityManager.setupAutoLock(after: 10)
        XCTAssertNotNil(securityManager.resignObserver)

        // Act
        securityManager.setupAutoLock(after: 0)

        // Assert
        XCTAssertNil(securityManager.resignObserver)
        XCTAssertNil(securityManager.becomeActiveObserver)
    }

    func testResetAutoLockTimer_StartsTimer() {
        // Arrange
        securityManager.isAuthenticated = true
        securityManager.autoLockMinutes = 5

        // Act
        securityManager.resetAutoLockTimer()

        // Assert
        XCTAssertNotNil(securityManager.autoLockTimer)
    }

    func testResetAutoLockTimer_DoesNotStartWhenNotAuthenticated() {
        // Arrange
        securityManager.isAuthenticated = false
        securityManager.autoLockMinutes = 5

        // Act
        securityManager.resetAutoLockTimer()

        // Assert
        XCTAssertNil(securityManager.autoLockTimer)
    }

    func testResetAutoLockTimer_DoesNotStartWhenMinutesZero() {
        // Arrange
        securityManager.isAuthenticated = true
        securityManager.autoLockMinutes = 0

        // Act
        securityManager.resetAutoLockTimer()

        // Assert
        XCTAssertNil(securityManager.autoLockTimer)
    }

    func testCancelAutoLockTimer_ClearsTimer() {
        // Arrange
        securityManager.isAuthenticated = true
        securityManager.autoLockMinutes = 5
        securityManager.resetAutoLockTimer()
        XCTAssertNotNil(securityManager.autoLockTimer)

        // Act
        securityManager.cancelAutoLockTimer()

        // Assert
        XCTAssertNil(securityManager.autoLockTimer)
    }

    func testLockForTimeout_Deauthenticates() {
        // Arrange
        securityManager.isAuthenticated = true

        // Act
        securityManager.lockForTimeout()

        // Assert
        XCTAssertFalse(securityManager.isAuthenticated)
    }
}
