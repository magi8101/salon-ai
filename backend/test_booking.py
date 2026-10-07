from main import book_appointment, db, get_availability

def test_booking_removes_slot():
    before = get_availability("Haircut", "Alex")
    assert any(s["time"] == "10:00 AM" for s in before), "Alex 10:00 AM must be free to run this check"
    try:
        assert book_appointment("haircut", "alex", "10am", "John")["success"]
        assert not any(s["time"] == "10:00 AM" for s in get_availability("Haircut", "Alex"))
        assert not book_appointment("Haircut", "Alex", "10:00 AM", "Jane")["success"]  # double-book rejected
        assert not book_appointment("Massage", "Alex", "1:00 PM", "Jane")["success"]   # unknown service
        assert not book_appointment("Haircut", "Alex", "1:00 PM", " ")["success"]      # no name
    finally:  # runs against the real DB: free the slot again
        db.table("slots").update({"booked_by": None, "service": None}).eq("stylist", "Alex").eq("time", "10:00 AM").execute()

if __name__ == "__main__":
    test_booking_removes_slot(); print("ok")
