"""Explicit sweep and handoff, no assumed external courier integration."""


def sweep(repository, now):
    return repository.sweep(now)


def handoff(repository, donation_id, recipient, now):
    return repository.donate(donation_id, recipient, now)
